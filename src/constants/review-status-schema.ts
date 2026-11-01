import { z } from "zod";

import {
  reviewStatusValues,
  paymentStatusValues,
  stationReviewStatusValues,
  resultStatusValues,
} from "./review-status";

// Kept apart from the status labels so client bundles that only need labels
// do not pull in zod.
export const reviewStatusEnum = z.enum(reviewStatusValues);
export const paymentStatusEnum = z.enum(paymentStatusValues);
export const stationReviewStatusEnum = z.enum(stationReviewStatusValues);
export const resultStatusEnum = z.enum(resultStatusValues);
