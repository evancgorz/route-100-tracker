# Route 100 model evaluation

Run the repeatable first-pass experiment with:

```bash
pnpm ml:experiment
```

The script reads `work/route100-history.sqlite` and the matching GTFS snapshot, then writes:

- `work/ml-experiment-latest.json` for machine-readable results
- `work/ml-experiment-latest.md` for a human-readable report

## Evaluation design

Each trip-day is one evaluation example. The target is the terminal live prediction, defined as the median of the final three predictions observed for that trip. Trips with fewer than three samples and incomplete collection days are excluded.

The latest complete day for each direction is held out. Earlier complete days are training data. The report compares:

- `schedule`: scheduled target-stop time
- `firstLivePrediction`: earliest prediction collected for the trip
- `ridgeModel`: a regularized regression using scheduled time, first live offset, and vehicle availability

The standard metrics are mean absolute error (MAE), root mean squared error (RMSE), bias, median absolute error, 90th-percentile absolute error, percentage within 2/5/10 minutes, and 80% interval coverage. The interval is an empirical prediction interval from training residuals; it is not a formal confidence interval until verified against actual stop-passage timestamps.

This is intentionally time-aware so future evaluations cannot leak test-day information into training. As more days accumulate, rerun the same command and compare the JSON metrics by direction and holdout date.
