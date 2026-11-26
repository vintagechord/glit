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

    def test_protocol_rejects_unknown_command(self):
        res = worker.handle({'id': 1, 'cmd': 'x'})
        self.assertEqual(res['id'], 1)
        self.assertFalse(res['ok'])
        self.assertIn('error', res)


if __name__ == '__main__':
    unittest.main()
