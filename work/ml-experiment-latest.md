# Route 100 ML experiment

Generated: 2026-09-14T11:05:39.437Z

This is a first-pass nowcast experiment using weekdays only. The target is the terminal live prediction for each trip, not a verified stop-passage time. The latest complete day is held out; no test-day rows are used to fit the model.

| Direction | Train days | Test day | Train trips | Test trips |
|---|---|---|---:|---:|
| Meredith → RTC arrival | 2026-08-27, 2026-08-28, 2026-08-31, 2026-09-02, 2026-09-03, 2026-09-04, 2026-09-07, 2026-09-09, 2026-09-10 | 2026-09-11 | 105 | 15 |
| RTC → Meredith departure | 2026-08-26, 2026-08-27, 2026-08-31, 2026-09-01, 2026-09-02, 2026-09-03, 2026-09-04, 2026-09-08, 2026-09-10 | 2026-09-11 | 133 | 14 |

## Meredith → RTC arrival

| Method | MAE | RMSE | Bias | P90 abs. error | Within 5 min | 80% interval coverage |
|---|---:|---:|---:|---:|---:|---:|
| schedule | 2.7 min | 3.0 min | -2.7 min | 4.9 min | 87% | — |
| firstLivePrediction | 0.3 min | 0.8 min | -0.2 min | 1.2 min | 100% | — |
| ridgeModel | 0.6 min | 1.1 min | 0.2 min | 1.5 min | 100% | 87% |

| Scheduled | Model estimate | 80% interval | Terminal prediction proxy | Samples | Vehicle coverage |
|---|---|---|---|---:|---:|
| 06:47 | 06:55 | 06:54–06:56 | 06:51 | 12 | 100% |
| 07:02 | 07:04 | 07:04–07:06 | 07:04 | 25 | 100% |
| 07:17 | 07:24 | 07:23–07:25 | 07:23 | 43 | 100% |
| 07:32 | 07:35 | 07:34–07:37 | 07:35 | 54 | 100% |
| 07:47 | 07:50 | 07:49–07:52 | 07:52 | 60 | 100% |
| 07:59 | 08:00 | 07:59–08:01 | 08:00 | 54 | 100% |
| 08:14 | 08:16 | 08:15–08:18 | 08:16 | 61 | 100% |
| 08:29 | 08:31 | 08:30–08:33 | 08:31 | 61 | 100% |
| 08:44 | 08:46 | 08:45–08:48 | 08:46 | 61 | 100% |
| 08:59 | 09:01 | 09:00–09:03 | 09:01 | 60 | 100% |
| 09:14 | 09:17 | 09:16–09:18 | 09:17 | 48 | 100% |
| 09:29 | 09:32 | 09:31–09:33 | 09:32 | 44 | 100% |
| 09:44 | 09:47 | 09:46–09:48 | 09:47 | 37 | 100% |
| 09:59 | 10:02 | 10:01–10:03 | 10:02 | 23 | 100% |
| 10:14 | 10:17 | 10:16–10:18 | 10:16 | 4 | 100% |

## RTC → Meredith departure

| Method | MAE | RMSE | Bias | P90 abs. error | Within 5 min | 80% interval coverage |
|---|---:|---:|---:|---:|---:|---:|
| schedule | 2.1 min | 3.8 min | -2.1 min | 6.4 min | 86% | — |
| firstLivePrediction | 1.7 min | 2.8 min | -1.7 min | 4.3 min | 93% | — |
| ridgeModel | 1.5 min | 2.1 min | 0.5 min | 3.5 min | 93% | 86% |

| Scheduled | Model estimate | 80% interval | Terminal prediction proxy | Samples | Vehicle coverage |
|---|---|---|---|---:|---:|
| 15:00 | 15:03 | 15:01–15:06 | 15:02 | 7 | 86% |
| 15:15 | 15:19 | 15:16–15:22 | 15:17 | 22 | 100% |
| 15:30 | 15:34 | 15:31–15:37 | 15:34 | 38 | 92% |
| 15:45 | 15:48 | 15:45–15:51 | 15:52 | 58 | 100% |
| 16:00 | 16:16 | 16:13–16:18 | 16:10 | 29 | 100% |
| 16:15 | 16:18 | 16:15–16:20 | 16:19 | 61 | 100% |
| 16:30 | 16:31 | 16:28–16:34 | 16:30 | 61 | 98% |
| 16:45 | 16:46 | 16:43–16:49 | 16:45 | 24 | 13% |
| 17:00 | 17:01 | 16:58–17:04 | 17:00 | 61 | 100% |
| 17:15 | 17:16 | 17:13–17:19 | 17:15 | 57 | 100% |
| 17:30 | 17:31 | 17:28–17:34 | 17:30 | 57 | 100% |
| 17:45 | 17:45 | 17:42–17:48 | 17:45 | 29 | 100% |
| 18:00 | 18:00 | 17:57–18:03 | 18:00 | 24 | 100% |
| 18:15 | 18:13 | 18:11–18:16 | 18:15 | 24 | 13% |

## Interpretation

- Use MAE and P90 absolute error as the primary regular metrics; bias shows systematic early/late behavior.
- The 80% interval is a calibration check, not a formal confidence interval.
- Sparse histories and fixed schedule predictions can make an interval look artificially narrow; the report retains sample and vehicle coverage so those cases are visible.
