#!/usr/bin/env python3
"""Onside 심의 데스크 음원 분석 워커.

stdin으로 JSON 한 줄씩 명령을 받고, stdout으로 JSON 한 줄씩 응답한다.
모델 작업(디코드, 보컬 분리, 에너지, Whisper 받아쓰기, 강제 점수, 가사 프롬프트 재받아쓰기)만 하고 판단은 Node가 한다.
라이브러리가 stdout에 찍는 것은 모두 stderr로 보낸다.
"""
import json
import math
import os
import subprocess
import sys

import numpy as np

WHISPER_REPO = 'mlx-community/whisper-large-v3-turbo'
MR_RESIDUAL_LIMIT_DB = -12.0
SR_HI = 44100
SR_LO = 16000
REDECODE_MAX_SEC = 30.0

_out = None  # 프로토콜 출력 핸들. main()에서만 설정한다.
_models = {}


def _finite(obj):
    """JSON에 못 쓰는 NaN·무한대를 None(null)으로 바꾼다(Node의 JSON.parse가 읽을 수 있게)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v) for v in obj]
    return obj


def protocol_line(obj):
    """응답 한 줄. 표준 JSON만 쓴다(allow_nan=False). 그래도 못 쓰면 그 요청의 오류 응답으로 바꾼다."""
    try:
        return json.dumps(_finite(obj), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        msg_id = obj.get('id') if isinstance(obj, dict) else None
        return json.dumps({'id': msg_id, 'ok': False, 'error': f'응답을 만들지 못했습니다: {exc}'}, ensure_ascii=False)


def emit(obj):
    if _out is None:
        return
    _out.write(protocol_line(obj) + '\n')
    _out.flush()


def progress(msg_id, stage):
    emit({'event': 'progress', 'id': msg_id, 'stage': stage})


# ---------- 오디오 입출력 ----------

def decode(path, sr, channels):
    """ffmpeg(imageio-ffmpeg)로 f32le를 읽는다. channels==1이면 (n,), 아니면 (n, ch)."""
    import imageio_ffmpeg
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', path,
           '-ar', str(sr), '-ac', str(channels), '-f', 'f32le', '-']
    p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0 or not p.stdout:
        tail = p.stderr.decode('utf-8', 'replace')[-300:]
        raise RuntimeError(f'오디오를 읽지 못했습니다: {tail}')
    a = np.frombuffer(p.stdout, dtype=np.float32)
    a = a[: (len(a) // channels) * channels]
    return a if channels == 1 else a.reshape(-1, channels)


def write_wav16(path, x):
    import soundfile as sf
    sf.write(path, np.clip(x, -1.0, 1.0), SR_LO, subtype='PCM_16')


def to_16k_mono(stereo44):
    import torch
    import torchaudio
    mono = np.ascontiguousarray(stereo44.mean(axis=1), dtype=np.float32)
    y = torchaudio.functional.resample(torch.from_numpy(mono), SR_HI, SR_LO)
    return y.numpy().astype(np.float32)


# ---------- MR 뺄셈 ----------

def mr_subtract(full, mr):
    """full - gain * mr (상호상관 시차 정렬). 결과 보컬은 full의 시간축에 맞춘다.
    반환: (vocals (n,2), residual_db). residual_db는 초 단위 잔여/원곡 레벨의 10퍼센타일."""
    a, b = full, mr
    x, y = a[:SR_HI * 60, 0], b[:SR_HI * 60, 0]
    n = 1 << (len(x) + len(y)).bit_length()
    c = np.fft.irfft(np.fft.rfft(x, n) * np.conj(np.fft.rfft(y, n)), n)
    lag = int(np.argmax(c))
    lag = lag if lag < n // 2 else lag - n
    if lag >= 0:
        a2, b2 = a[lag:], b
    else:
        a2, b2 = a, b[-lag:]
    m = min(len(a2), len(b2))
    a2, b2 = a2[:m], b2[:m]
    denom = float(np.sum(b2.astype(np.float64) ** 2))
    g = float(np.sum(a2.astype(np.float64) * b2) / denom) if denom > 0 else 0.0
    v = (a2 - g * b2).astype(np.float32)
    full_pow = float(np.mean(a2.astype(np.float64) ** 2)) + 1e-12
    per_sec = [10 * np.log10(float(np.mean(v[i:i + SR_HI].astype(np.float64) ** 2)) / full_pow + 1e-12)
               for i in range(0, m - SR_HI + 1, SR_HI)]
    if not per_sec:
        per_sec = [10 * np.log10(float(np.mean(v.astype(np.float64) ** 2)) / full_pow + 1e-12)]
    residual_db = float(np.percentile(per_sec, 10))
    if lag > 0:
        v = np.concatenate([np.zeros((lag, v.shape[1]), dtype=np.float32), v])
    return v, residual_db


# ---------- demucs ----------

def _demucs_model():
    if 'demucs' not in _models:
        from demucs.pretrained import get_model
        model = get_model('htdemucs')
        model.cpu()
        model.eval()
        _models['demucs'] = model
    return _models['demucs']


def separate_demucs(wav44k_stereo):
    """(n,2) 44.1kHz float -> 보컬 (n,2). CPU 전용(MPS 안 씀)."""
    import torch
    from demucs.apply import apply_model
    model = _demucs_model()
    mix = torch.from_numpy(np.ascontiguousarray(wav44k_stereo.T, dtype=np.float32))
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std()
    mix = (mix - mean) / (std + 1e-8)
    with torch.no_grad():
        src = apply_model(model, mix[None], device='cpu', split=True, overlap=0.25, progress=False)[0]
    src = src * std + mean
    vocals = src[model.sources.index('vocals')]
    return vocals.numpy().T.copy()


# ---------- 에너지 ----------

def _frame_db(x16k, hop):
    """0.25초 프레임별 평균 제곱의 dB(numpy 배열)."""
    n = int(round(SR_LO * hop))
    frames = len(x16k) // n
    if frames == 0:
        return np.zeros(0)
    x = np.asarray(x16k[: frames * n], dtype=np.float64).reshape(frames, n)
    return 10 * np.log10(np.mean(x ** 2, axis=1) + 1e-12)


def energy(vocals16k, hop=0.25):
    """0.25초 프레임별 dB, 보컬 스템 자신의 90퍼센타일 기준 상대값(늘 10% 이상이 0dB 이상이다)."""
    e = _frame_db(vocals16k, hop)
    if len(e) == 0:
        return []
    return [float(v) for v in (e - np.percentile(e, 90))]


def level(vocals16k, mix16k, hop=0.25):
    """0.25초 프레임별 보컬 dB, 원음(분리 전 믹스) 프레임 dB의 90퍼센타일 기준. 스템 자신이 아니라 믹스를 기준으로 하므로
    보컬이 없는 곡이나 같은 음원끼리 뺀 MR처럼 스템이 조용하면 모든 프레임이 낮게 나온다(보컬 없음·MR 판단용)."""
    v = _frame_db(vocals16k, hop)
    m = _frame_db(mix16k, hop)
    if len(v) == 0 or len(m) == 0:
        return []
    return [float(x) for x in (v - np.percentile(m, 90))]


# ---------- Whisper ----------

def _whisper_model():
    if 'whisper' not in _models:
        import mlx.core as mx
        from mlx_whisper.transcribe import ModelHolder
        _models['whisper'] = ModelHolder.get_model(WHISPER_REPO, mx.float16)
    return _models['whisper']


def transcribe(vocals16k, language):
    import mlx_whisper
    _whisper_model()
    r = mlx_whisper.transcribe(
        np.ascontiguousarray(vocals16k, dtype=np.float32),
        path_or_hf_repo=WHISPER_REPO, language=language or None,
        condition_on_previous_text=False, word_timestamps=True,
        hallucination_silence_threshold=2.0, temperature=(0.0, 0.2, 0.4),
        no_speech_threshold=0.5, compression_ratio_threshold=2.2, verbose=None)
    segs = []
    for s in r['segments']:
        words = [{'s': round(float(w['start']), 2), 'e': round(float(w['end']), 2), 'w': w['word'].strip()}
                 for w in s.get('words', [])]
        segs.append({'s': round(float(s['start']), 2), 'e': round(float(s['end']), 2),
                     't': s['text'].strip(), 'words': words})
    return segs


def _tokenizer(model):
    if 'tok' not in _models:
        from mlx_whisper.tokenizer import get_tokenizer
        _models['tok'] = get_tokenizer(model.is_multilingual, num_languages=model.num_languages,
                                       language='ko', task='transcribe')
    return _models['tok']


def _vocals_window(vocals_path, start, end):
    import soundfile as sf
    x, sr = sf.read(vocals_path, dtype='float32')
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR_LO:
        raise RuntimeError('vocals.wav는 16kHz여야 합니다')
    return np.ascontiguousarray(x[int(start * SR_LO):int(end * SR_LO)])


def score(vocals_path, start, end, candidates):
    """후보 문장별 log P(후보 토큰 + EOT | 창 오디오). 창은 30초로 패딩/자른다."""
    import mlx.core as mx
    from mlx_whisper.audio import N_FRAMES, log_mel_spectrogram, pad_or_trim
    model = _whisper_model()
    tok = _tokenizer(model)
    sot = list(tok.sot_sequence_including_notimestamps)
    seg = _vocals_window(vocals_path, start, end)
    mel = log_mel_spectrogram(seg, n_mels=model.dims.n_mels)
    mel = pad_or_trim(mel, N_FRAMES, axis=-2).astype(mx.float16)
    feat = model.embed_audio(mel[None])
    out = []
    for text in candidates:
        body = tok.encode(' ' + text) if text else []
        toks = sot + body + [tok.eot]
        lg = model.logits(mx.array([toks[:-1]]), feat)[0].astype(mx.float32)
        lp = lg - mx.logsumexp(lg, axis=-1, keepdims=True)
        tgt = toks[len(sot):]
        out.append(float(sum(lp[len(sot) - 1 + i, t].item() for i, t in enumerate(tgt))))
    return out


def redecode_args(msg):
    """redecode 인자 검사(모델을 읽기 전에). 창은 REDECODE_MAX_SEC로 자른다."""
    vocals = msg.get('vocals')
    if not isinstance(vocals, str) or not vocals:
        raise ValueError('vocals 경로가 없습니다')
    try:
        start = float(msg.get('start'))
        end = float(msg.get('end'))
    except (TypeError, ValueError):
        raise ValueError('구간 시각이 숫자가 아닙니다') from None
    if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start:
        raise ValueError('구간이 올바르지 않습니다')
    prompt = msg.get('prompt')
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('prompt가 없습니다')
    return vocals, start, min(end, start + REDECODE_MAX_SEC), prompt


def redecode(vocals_path, start, end, prompt):
    """가사 줄을 initial_prompt로 주고 창을 다시 받아쓴다(온도 0, 낱말 시각 없음)."""
    import mlx_whisper
    seg = _vocals_window(vocals_path, start, end)
    _whisper_model()
    r = mlx_whisper.transcribe(
        seg, path_or_hf_repo=WHISPER_REPO, language='ko', initial_prompt=prompt,
        condition_on_previous_text=False, temperature=0.0, no_speech_threshold=0.9,
        word_timestamps=False, verbose=None)
    return ' '.join(t for t in (s['text'].strip() for s in r['segments']) if t)


# ---------- 명령 ----------

def analyze(msg_id, args):
    out_dir = args['outDir']
    os.makedirs(out_dir, exist_ok=True)
    progress(msg_id, 'decode')
    full = decode(args['file'], SR_HI, 2)
    vocals44, residual_db, separation = None, None, 'demucs'
    if args.get('mr'):
        mr = decode(args['mr'], SR_HI, 2)
        v, residual_db = mr_subtract(full, mr)
        if residual_db <= MR_RESIDUAL_LIMIT_DB:
            vocals44, separation = v, 'mr'
    if vocals44 is None:
        progress(msg_id, 'separate')
        vocals44 = separate_demucs(full)
    vocals16 = to_16k_mono(vocals44)
    vocals_path = os.path.join(out_dir, 'vocals.wav')
    write_wav16(vocals_path, vocals16)
    segments = []
    if args.get('transcribe', True):
        progress(msg_id, 'transcribe')
        segments = transcribe(vocals16, args.get('language'))
    return {'duration': len(full) / SR_HI, 'separation': separation,
            'residualDb': residual_db, 'vocals': vocals_path,
            'energy': energy(vocals16), 'level': level(vocals16, to_16k_mono(full)),
            'segments': segments}


def handle(msg):
    msg_id = msg.get('id')
    cmd = msg.get('cmd')
    try:
        if cmd == 'warmup':
            progress(msg_id, 'warmup')
            _whisper_model()
            _demucs_model()
            result = {'whisper': True, 'demucs': True}
        elif cmd == 'analyze':
            result = analyze(msg_id, msg)
        elif cmd == 'score':
            progress(msg_id, 'score')
            result = {'scores': score(msg['vocals'], float(msg['start']), float(msg['end']),
                                      list(msg['candidates']))}
        elif cmd == 'redecode':
            args = redecode_args(msg)
            progress(msg_id, 'score')
            result = {'text': redecode(*args)}
        else:
            return {'id': msg_id, 'ok': False, 'error': f'알 수 없는 명령: {cmd}'}
        return {'id': msg_id, 'ok': True, 'result': result}
    except Exception as exc:  # noqa: BLE001 - 프로토콜 오류로 돌려준다
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {'id': msg_id, 'ok': False, 'error': f'{type(exc).__name__}: {exc}'}


def main():
    global _out
    # fd 1을 stderr로 돌리고, 프로토콜은 복제한 핸들로만 쓴다.
    _out = os.fdopen(os.dup(1), 'w', encoding='utf-8')
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            emit({'id': None, 'ok': False, 'error': '명령을 읽지 못했습니다'})
            continue
        emit(handle(msg))


if __name__ == '__main__':
    main()
