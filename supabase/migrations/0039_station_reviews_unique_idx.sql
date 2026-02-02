create unique index if not exists station_reviews_submission_station_key
  on public.station_reviews(submission_id, station_id);
