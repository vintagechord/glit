import importlib.util
import os
import unittest

try:
    import numpy as np
except ImportError:  # 엔진 venv가 아니면 건너뛴다
    np = None

HERE = os.path.dirname(os.path.abspath(__file__))
worker = None
if np is not None:
    spec = importlib.util.spec_from_file_location('audio_check_worker', os.path.join(HERE, 'worker.py'))
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)

SR = 44100


def make_signals(seconds=12, delay=300, seed=1):
    rng = np.random.default_rng(seed)
    n = SR * seconds
    mr = rng.standard_normal((n, 2)).astype(np.float32) * 0.1
    t = np.arange(n) / SR
    voc = np.zeros(n, dtype=np.float32)
    gate = ((t >= 4) & (t < 8)).astype(np.float32)  # 보컬은 4~8초에만
    voc = (0.1 * np.sin(2 * np.pi * 440 * t) * gate).astype(np.float32)
    vocal = np.stack([voc, voc], axis=1)
    full = mr + vocal
    full = np.concatenate([np.zeros((delay, 2), dtype=np.float32), full])  # 원곡이 delay 샘플 늦다
    vocal_full = np.concatenate([np.zeros((delay, 2), dtype=np.float32), vocal])
    return full, mr, vocal_full


@unittest.skipIf(np is None, 'engine venv 없음')
class WorkerTest(unittest.TestCase):
    def test_mr_subtraction_recovers_vocal_and_reports_residual(self):
        full, mr, vocal_full = make_signals()
        vocals, residual_db = worker.mr_subtract(full, mr)
        m = min(len(vocals), len(vocal_full))
        corr = np.corrcoef(vocals[:m, 0], vocal_full[:m, 0])[0, 1]
        self.assertGreater(corr, 0.95)
        self.assertLess(residual_db, -30)

    def test_mr_subtraction_reports_failure_for_different_master(self):
        full, mr, _ = make_signals()
        kernel = np.ones(8, dtype=np.float32) / 8  # 다른 EQ: 고역을 깎는다
        eq = np.stack([np.convolve(mr[:, c], kernel, mode='same') for c in range(2)], axis=1)
        _, residual_db = worker.mr_subtract(full, eq)
        self.assertGreater(residual_db, -12)

    def test_energy_is_relative_to_90th_percentile(self):
        rng = np.random.default_rng(2)
        x = (rng.standard_normal(16000 * 10) * 0.1).astype(np.float32)
        x[16000 * 5:] *= 0.01
        e = worker.energy(x)
        self.assertEqual(len(e), 40)
        self.assertGreaterEqual(max(e), 0)
        self.assertLess(min(e), -30)

    def test_energy_cannot_tell_a_silent_stem_but_level_can(self):
        # 스템 자신 기준인 energy는 늘 10% 이상이 0dB 이상이다. 믹스 기준 level은 조용한 스템을 모두 낮게 낸다.
        rng = np.random.default_rng(3)
        mix = (rng.standard_normal(16000 * 10) * 0.1).astype(np.float32)
        silent = (rng.standard_normal(16000 * 10) * 1e-5).astype(np.float32)
        e = worker.energy(silent)
        self.assertGreaterEqual(sum(v >= -15 for v in e) / len(e), 0.1)
        lv = worker.level(silent, mix)
        self.assertEqual(len(lv), 40)
        self.assertEqual(sum(v >= -15 for v in lv), 0)
        sung = mix.copy()
        sung[16000 * 5:] *= 1e-4  # 앞 5초만 보컬
        lv = worker.level(sung, mix)
        self.assertAlmostEqual(sum(v >= -15 for v in lv) / len(lv), 0.5, delta=0.03)
        self.assertEqual(worker.level(np.zeros(100, dtype=np.float32), mix), [])

    def test_same_audio_mr_subtraction_leaves_no_vocal_level(self):
        full, _, _ = make_signals()
        vocals, residual_db = worker.mr_subtract(full, full)
        self.assertLess(residual_db, -12)  # 뺄셈은 받아들여지지만
        v16 = vocals.mean(axis=1)[::3][: len(full) // 3]  # 대략 16kHz(검사용)
        m16 = full.mean(axis=1)[::3][: len(full) // 3]
        lv = worker.level(v16, m16)
        self.assertLess(sum(v >= -15 for v in lv) / len(lv), 0.05)  # 남은 보컬이 없다

    def test_protocol_rejects_unknown_command(self):
        res = worker.handle({'id': 1, 'cmd': 'x'})
        self.assertEqual(res['id'], 1)
        self.assertFalse(res['ok'])
        self.assertIn('error', res)

    def test_redecode_rejects_bad_arguments_without_loading_the_model(self):
        loaded = 'whisper' in worker._models
        good = {'vocals': '/없는/vocals.wav', 'start': 3, 'end': 9, 'prompt': '바람 따라 걸어가요'}
        bad = [
            {},
            {**good, 'vocals': ''},
            {**good, 'vocals': None},
            {**good, 'start': 'x'},
            {**good, 'start': -1},
            {**good, 'end': 3},
            {**good, 'end': float('nan')},
            {**good, 'prompt': ''},
            {**good, 'prompt': '   '},
            {**good, 'prompt': None},
        ]
        for args in bad:
            res = worker.handle({'id': 7, 'cmd': 'redecode', **args})
            self.assertEqual(res['id'], 7)
            self.assertFalse(res['ok'], args)
            self.assertIn('ValueError', res['error'], args)
        self.assertEqual('whisper' in worker._models, loaded)

    def test_redecode_window_is_clamped_to_30_seconds(self):
        self.assertEqual(
            worker.redecode_args({'vocals': '/v.wav', 'start': 10, 'end': 55.5, 'prompt': '가사 한 줄'}),
            ('/v.wav', 10.0, 40.0, '가사 한 줄'))
        self.assertEqual(
            worker.redecode_args({'vocals': '/v.wav', 'start': '1.5', 'end': 4, 'prompt': '가사'}),
            ('/v.wav', 1.5, 4.0, '가사'))


if __name__ == '__main__':
    unittest.main()
