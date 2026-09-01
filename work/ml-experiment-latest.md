# Route 100 ML experiment

Generated: 2026-09-01T14:32:53.706Z

This is a first-pass nowcast experiment. The target is the terminal live prediction for each trip, not a verified stop-passage time. The latest complete day is held out; no test-day rows are used to fit the model.

| Direction | Train days | Test day | Train trips | Test trips |
|---|---|---|---:|---:|
| Meredith → RTC arrival | 2026-08-27, 2026-08-28, 2026-08-29, 2026-08-30 | 2026-08-31 | 37 | 12 |
| RTC → Meredith departure | 2026-08-26, 2026-08-27, 2026-08-29, 2026-08-30 | 2026-08-31 | 41 | 15 |

## Meredith → RTC arrival

| Method | MAE | RMSE | Bias | P90 abs. error | Within 5 min | 80% interval coverage |
|---|---:|---:|---:|---:|---:|---:|
| schedule | 3.3 min | 4.0 min | -3.3 min | 6.2 min | 75% | — |
| firstLivePrediction | 1.1 min | 2.0 min | -0.4 min | 4.0 min | 100% | — |
| ridgeModel | 1.4 min | 2.9 min | 0.3 min | 3.0 min | 92% | 75% |

| Scheduled | Model estimate | 80% interval | Terminal prediction proxy | Samples | Vehicle coverage |
|---|---|---|---|---:|---:|
| 07:02 | 07:09 | 07:08–07:11 | 07:11 | 32 | 100% |
| 07:17 | 07:31 | 07:30–07:33 | 07:22 | 43 | 100% |
| 07:32 | 07:35 | 07:34–07:37 | 07:38 | 59 | 100% |
| 07:47 | 07:50 | 07:49–07:52 | 07:51 | 59 | 100% |
| 07:59 | 07:59 | 07:58–08:01 | 08:00 | 54 | 100% |
| 08:29 | 08:31 | 08:30–08:33 | 08:31 | 61 | 100% |
| 08:44 | 08:46 | 08:45–08:48 | 08:46 | 61 | 100% |
| 08:59 | 09:01 | 09:00–09:03 | 09:01 | 61 | 100% |
| 09:14 | 09:17 | 09:16–09:18 | 09:16 | 48 | 100% |
| 09:29 | 09:32 | 09:31–09:33 | 09:31 | 42 | 100% |
| 09:59 | 10:02 | 10:01–10:03 | 10:01 | 17 | 100% |
| 10:14 | 10:17 | 10:15–10:18 | 10:16 | 6 | 100% |

## RTC → Meredith departure

| Method | MAE | RMSE | Bias | P90 abs. error | Within 5 min | 80% interval coverage |
|---|---:|---:|---:|---:|---:|---:|
| schedule | 4.0 min | 7.5 min | -4.0 min | 11.7 min | 67% | — |
| firstLivePrediction | 4.0 min | 7.5 min | -4.0 min | 11.7 min | 67% | — |
| ridgeModel | 3.5 min | 5.8 min | -2.2 min | 7.6 min | 87% | 67% |

| Scheduled | Model estimate | 80% interval | Terminal prediction proxy | Samples | Vehicle coverage |
|---|---|---|---|---:|---:|
| 15:00 | 15:05 | 15:02–15:08 | 15:07 | 12 | 100% |
| 15:15 | 15:20 | 15:17–15:22 | 15:16 | 22 | 100% |
| 15:30 | 15:34 | 15:31–15:37 | 15:39 | 43 | 100% |
| 15:45 | 15:49 | 15:46–15:51 | 15:59 | 61 | 100% |
| 16:00 | 16:03 | 16:00–16:06 | 16:22 | 60 | 100% |
| 16:15 | 16:18 | 16:15–16:20 | 16:22 | 61 | 100% |
| 16:30 | 16:32 | 16:30–16:35 | 16:30 | 60 | 100% |
| 16:45 | 16:46 | 16:43–16:48 | 16:45 | 21 | 0% |
| 17:00 | 17:02 | 16:59–17:04 | 17:00 | 61 | 100% |
| 17:15 | 17:16 | 17:13–17:18 | 17:15 | 60 | 100% |
| 17:30 | 17:31 | 17:28–17:33 | 17:30 | 48 | 100% |
| 17:45 | 17:45 | 17:42–17:47 | 17:45 | 14 | 100% |
| 18:00 | 18:00 | 17:57–18:02 | 18:00 | 15 | 100% |
| 18:15 | 18:13 | 18:10–18:15 | 18:15 | 21 | 0% |
| 18:30 | 18:29 | 18:26–18:31 | 18:30 | 7 | 100% |

## Interpretation

- Use MAE and P90 absolute error as the primary regular metrics; bias shows systematic early/late behavior.
- The 80% interval is a calibration check, not a formal confidence interval.
- Sparse histories and fixed schedule predictions can make an interval look artificially narrow; the report retains sample and vehicle coverage so those cases are visible.
