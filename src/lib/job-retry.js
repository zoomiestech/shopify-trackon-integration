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

  if (error?.trackonResponse && error.permanent) {
    return reason;
  }

  if (error?.permanent) {
    return `Booking not attempted: ${reason}`;
  }

  return `Booking failed after ${attempts || 1} attempts: ${reason}`;
}
