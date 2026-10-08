// How a failed booking job is retried. Only errors that can clear on their
// own (network errors, timeouts, Trackon 5xx) are retried; an error marked
// permanent, such as a Trackon rejection, is final at once. Few retries on
// purpose: if Trackon booked but the reply was lost, each retry risks a
// second AWB.
export const MAX_JOB_ATTEMPTS = 3;

export function retryPlan({ attempts, permanent } = {}) {
  const attempt = attempts || 1;

  if (permanent || attempt >= MAX_JOB_ATTEMPTS) {
    return { final: true, delaySeconds: null };
  }

  return { final: false, delaySeconds: 60 * attempt };
}

// The history line for a booking that will not be retried.
export function failureSummary(error, attempts) {
  const reason = String(error?.message || error).slice(0, 300);

  // Trackon's own answer, or our no-reply message, already says what
  // happened.
  if (error?.permanent && (error.trackonResponse || error.possiblyBooked)) {
    return reason;
  }

  if (error?.permanent) {
    return `Booking not attempted: ${reason}`;
  }

  return `Booking failed after ${attempts || 1} attempts: ${reason}`;
}

// The full history line, with what staff should do next.
export function failureHistoryLine(error, attempts, failedTag) {
  const advice = error?.possiblyBooked
    ? `If it was booked, attach its AWB instead of retrying; removing the ${failedTag} tag books it again.`
    : `Fix the order, then remove the ${failedTag} tag to retry.`;

  return `${failureSummary(error, attempts)}. ${advice}`;
}
