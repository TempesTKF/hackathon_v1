function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function patientBucket(patient) {
  const isFemale = String(patient?.gender || '').includes('女');
  const age = Number(patient?.age || 30);
  if (age < 14) return isFemale ? 'childFemale' : 'childMale';
  if (age >= 60) return isFemale ? 'elderlyFemale' : 'elderlyMale';
  return isFemale ? 'adultFemale' : 'adultMale';
}

function pickVoice(env, patient) {
  const bucket = patientBucket(patient);
  const fallback = env.PPIO_TTS_VOICE || (bucket.includes('Female') ? 'female-shaonv' : 'male-qn-qingse');
  const voiceMap = {
    childFemale: env.PPIO_TTS_VOICE_CHILD_FEMALE || env.PPIO_TTS_VOICE_CHILD,
    childMale: env.PPIO_TTS_VOICE_CHILD_MALE || env.PPIO_TTS_VOICE_CHILD,
    adultFemale: env.PPIO_TTS_VOICE_ADULT_FEMALE,
    adultMale: env.PPIO_TTS_VOICE_ADULT_MALE,
    elderlyFemale: env.PPIO_TTS_VOICE_ELDERLY_FEMALE || env.PPIO_TTS_VOICE_ADULT_FEMALE,
    elderlyMale: env.PPIO_TTS_VOICE_ELDERLY_MALE || env.PPIO_TTS_VOICE_ADULT_MALE,
  };
  return voiceMap[bucket] || fallback;
}

function baseVoiceShape(env, patient) {
  const bucket = patientBucket(patient);
  const base = {
    childFemale: { speed: 1.08, pitch: 4, vol: 1 },
    childMale: { speed: 1.06, pitch: 3, vol: 1 },
    adultFemale: { speed: 0.98, pitch: 1, vol: 1 },
    adultMale: { speed: 0.96, pitch: -1, vol: 1 },
    elderlyFemale: { speed: 0.82, pitch: -4, vol: 0.92 },
    elderlyMale: { speed: 0.78, pitch: -6, vol: 0.92 },
  };
  return { voiceId: pickVoice(env, patient), ...base[bucket] };
}

function textVoiceDelta(text) {
  const delta = { speed: 0, pitch: 0, vol: 0 };
  if (/疼|痛|难受|受不了|撑不住|救命/.test(text)) { delta.speed += 0.04; delta.pitch += 1.2; delta.vol += 0.04; }
  if (/喘|呼吸|憋|胸闷|上不来气/.test(text)) { delta.speed += 0.08; delta.pitch += 0.8; delta.vol -= 0.04; }
  if (/怕|害怕|担心|紧张|不会死/.test(text)) { delta.speed += 0.06; delta.pitch += 1.4; }
  if (/哭|想哭|呜|崩溃/.test(text)) { delta.speed -= 0.03; delta.pitch += 2; delta.vol -= 0.08; }
  if (/笑|哈哈|好多了|谢谢|舒服多了|不疼了|治好了/.test(text)) { delta.speed += 0.04; delta.pitch += 1; delta.vol += 0.02; }
  if (/烦|生气|别|不想|你到底|太慢/.test(text)) { delta.speed += 0.07; delta.pitch -= 0.5; delta.vol += 0.08; }
  return delta;
}

function performanceVoiceDelta(context) {
  const delta = { speed: 0, pitch: 0, vol: 0 };
  const intensity = clamp(Number(context?.performance?.intensity ?? 0.45), 0, 1);
  switch (context?.performance?.emotion) {
    case 'pain': delta.speed += 0.05 * intensity; delta.pitch += 1.8 * intensity; delta.vol += 0.04 * intensity; break;
    case 'fear': delta.speed += 0.08 * intensity; delta.pitch += 2.1 * intensity; break;
    case 'nausea': delta.speed -= 0.04 * intensity; delta.pitch -= 0.5 * intensity; delta.vol -= 0.04 * intensity; break;
    case 'weak': delta.speed -= 0.12 * intensity; delta.pitch -= 1.2 * intensity; delta.vol -= 0.16 * intensity; break;
    case 'relieved': delta.speed -= 0.03 * intensity; delta.pitch += 0.5 * intensity; delta.vol -= 0.02 * intensity; break;
    case 'crying': delta.speed -= 0.06 * intensity; delta.pitch += 2.4 * intensity; delta.vol -= 0.1 * intensity; break;
    case 'laugh': delta.speed += 0.05 * intensity; delta.pitch += 1.4 * intensity; delta.vol += 0.02 * intensity; break;
    case 'angry':
    case 'impatient': delta.speed += 0.08 * intensity; delta.pitch -= 0.6 * intensity; delta.vol += 0.08 * intensity; break;
    case 'confused': delta.speed -= 0.02 * intensity; delta.pitch += 0.8 * intensity; break;
  }
  return delta;
}

function stateVoiceDelta(context) {
  const delta = { speed: 0, pitch: 0, vol: 0 };
  const state = context?.state;
  if (!state) return delta;
  const hp = Number(state.hp ?? 100);
  const hpMax = Number(state.hpMax ?? 100);
  const hpRatio = hpMax > 0 ? hp / hpMax : 1;
  if (hpRatio < 0.35) { delta.speed -= 0.11; delta.pitch -= 1.2; delta.vol -= 0.14; }
  else if (hpRatio < 0.6) { delta.speed -= 0.04; delta.pitch -= 0.4; delta.vol -= 0.06; }
  if (state.phase === 'critical') { delta.speed += 0.03; delta.pitch += 0.8; delta.vol -= 0.08; }
  if (state.phase === 'recovering' || state.phase === 'cured') { delta.speed -= 0.04; delta.pitch += 0.4; delta.vol += 0.02; }
  if ((state.vitals?.hr ?? 0) >= 120) delta.speed += 0.04;
  if ((state.vitals?.spo2 ?? 100) < 94) delta.speed += 0.05;
  return delta;
}

function resolveVoiceShape(env, patient, context, text) {
  const shape = baseVoiceShape(env, patient);
  for (const delta of [textVoiceDelta(text), performanceVoiceDelta(context), stateVoiceDelta(context)]) {
    shape.speed += delta.speed; shape.pitch += delta.pitch; shape.vol += delta.vol;
  }
  shape.speed = clamp(Number(env.PPIO_TTS_SPEED || shape.speed), 0.72, 1.24);
  shape.pitch = Math.round(clamp(Number(env.PPIO_TTS_PITCH || shape.pitch), -8, 8));
  shape.vol = clamp(Number(env.PPIO_TTS_VOL || shape.vol), 0.68, 1.12);
  return shape;
}

function hexAudioFromResponse(data) {
  return data.audio || data.audio_hex || data.data?.audio || data.data?.audio_hex || data.result?.audio || data.result?.audio_hex;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  try {
    const env = process.env;
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const text = String(body.text || '').trim();
    if (!text) {
      res.status(400).send('Missing text');
      return;
    }
    const apiKey = env.PPIO_TTS_API_KEY || env.PPIO_API_KEY || env.VITE_LLM_API_KEY;
    const endpoint = env.PPIO_TTS_ENDPOINT || 'https://api.ppio.com/v3/minimax-speech-2.8-turbo';
    if (!apiKey) {
      res.status(500).send('Missing PPIO_TTS_API_KEY or PPIO_API_KEY');
      return;
    }
    const voice = resolveVoiceShape(env, body.patient || {}, body.context || {}, text);
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        stream: false,
        text,
        audio_setting: {
          format: env.PPIO_TTS_FORMAT || 'mp3',
          bitrate: Number(env.PPIO_TTS_BITRATE || 128000),
          channel: Number(env.PPIO_TTS_CHANNEL || 1),
          force_cbr: env.PPIO_TTS_FORCE_CBR === 'true',
          sample_rate: Number(env.PPIO_TTS_SAMPLE_RATE || 32000),
        },
        output_format: 'hex',
        voice_setting: {
          voice_id: voice.voiceId,
          vol: voice.vol,
          pitch: voice.pitch,
          speed: voice.speed,
          latex_read: false,
          text_normalization: false,
        },
        aigc_watermark: env.PPIO_TTS_WATERMARK === 'true',
        stream_options: { exclude_aggregated_audio: false },
        subtitle_enable: false,
        continuous_sound: false,
      }),
    });
    if (!upstream.ok) {
      res.status(upstream.status).send((await upstream.text()).slice(0, 500));
      return;
    }
    const contentType = upstream.headers.get('content-type') || '';
    let audio;
    if (contentType.includes('audio/')) audio = Buffer.from(await upstream.arrayBuffer());
    else {
      const data = await upstream.json();
      const hex = hexAudioFromResponse(data);
      if (!hex || typeof hex !== 'string') {
        res.status(502).send('PPIO TTS response missing hex audio: ' + JSON.stringify(data).slice(0, 500));
        return;
      }
      audio = Buffer.from(hex, 'hex');
    }
    res.status(200);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'no-store');
    res.send(audio);
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : String(error));
  }
}
