const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const requestPath = process.argv[2];
if (!requestPath) fail('Pass a NICHEFOUNDRY_PRODUCTION_REQUEST.json path.');
const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
const scenes = request.scene_images || [];
if (scenes.length !== 3 || scenes.some((item) => !fs.existsSync(item))) fail('Exactly three existing scene images are required.');
const music = request.music?.path;
if (!music || !fs.existsSync(music)) fail('A rights-recorded music bed is required.');
const output = request.outputs?.vertical_reel;
if (!output) fail('The request has no vertical reel output path.');
fs.mkdirSync(path.dirname(output), { recursive: true });

const args = ['-y'];
for (const scene of scenes) args.push('-loop', '1', '-t', '4.5', '-i', scene);
args.push('-stream_loop', '-1', '-i', music);
args.push(
  '-filter_complex',
  "[0:v]scale=1120:1992,crop=1080:1920,zoompan=z='min(zoom+0.00055,1.045)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=135:s=1080x1920:fps=30,format=yuv420p[v0];" +
  "[1:v]scale=1120:1992,crop=1080:1920,zoompan=z='min(zoom+0.00055,1.045)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=135:s=1080x1920:fps=30,format=yuv420p[v1];" +
  "[2:v]scale=1120:1992,crop=1080:1920,zoompan=z='min(zoom+0.00055,1.045)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=135:s=1080x1920:fps=30,format=yuv420p[v2];" +
  '[v0][v1]xfade=transition=fade:duration=0.5:offset=4.0[v01];' +
  '[v01][v2]xfade=transition=fade:duration=0.5:offset=8.0[v];' +
  '[3:a]volume=0.18,afade=t=in:st=0:d=0.5,afade=t=out:st=11.5:d=0.5[a]',
  '-map', '[v]', '-map', '[a]', '-t', '12', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output
);
const result = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.status !== 0) fail((result.stderr || result.stdout || 'ffmpeg failed').slice(-3000));
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', output], { encoding: 'utf8' });
if (probe.status !== 0) fail(probe.stderr || 'ffprobe failed');
const receipt = {
  schema: 'nichefoundry.dio_campaign_reel_receipt.v1',
  family_id: request.family_id,
  request_hash: request.request_hash,
  created_at: new Date().toISOString(),
  output,
  music_attribution: request.music.attribution,
  voice: 'caption-led_no_synthetic_voice',
  release: 'held_for_operator_approval',
  probe: JSON.parse(probe.stdout)
};
fs.writeFileSync(path.join(path.dirname(output), 'NICHEFOUNDRY_REEL_RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
