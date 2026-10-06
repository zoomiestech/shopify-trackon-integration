// Helpers over a normalized Trackon tracking response: the summary row plus
// the scan history in lstDetails, as documented in Trackon's tracking API.

export function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

export function trackingRows(tracking) {
  const rows = [];

  if (tracking) {
    rows.push({
      CURRENT_CITY: tracking.city || "",
      CURRENT_STATUS: tracking.status || "",
      EVENTDATE: tracking.eventDate || "",
      EVENTTIME: tracking.eventTime || "",
      TRACKING_CODE: tracking.trackingCode || "",
    });
  }

  if (Array.isArray(tracking?.details)) {
    rows.push(...tracking.details);
  }

  return rows;
}

export function rowCode(row) {
  return normalizeCode(
    row?.TRACKING_CODE ||
    row?.TrackingCode ||
    row?.trackingCode
  );
}

export function rowStatus(row) {
  return String(
    row?.CURRENT_STATUS ||
    row?.CurrentStatus ||
    row?.currentStatus ||
    ""
  ).trim();
}

export function rowCity(row) {
  return String(
    row?.CURRENT_CITY ||
    row?.CurrentCity ||
    row?.currentCity ||
    ""
  ).trim();
}

function rowDate(row) {
  return String(row?.EVENTDATE || row?.EventDate || row?.eventDate || "").trim();
}

function rowTime(row) {
  return String(row?.EVENTTIME || row?.EventTime || row?.eventTime || "").trim();
}

// One Trackon scan: the same code at the same date and time is the same event.
export function rowKey(row) {
  return `${rowCode(row)}|${rowDate(row)}|${rowTime(row)}`;
}

// Trackon sends dd/mm/yyyy and HH:MM(:SS) in India time.
export function trackonEventTime(eventDate, eventTime) {
  if (!eventDate) {
    return undefined;
  }

  const rawDate = String(eventDate).trim();
  const rawTime = String(eventTime || "00:00:00").trim() || "00:00:00";

  const match = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (match) {
    const [, dd, mm, yyyy] = match;
    const date = new Date(
      `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${rawTime}+05:30`
    );

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const fallback = new Date(`${rawDate} ${rawTime}`);

  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }

  return undefined;
}

export function rowDateTime(row) {
  if (!row) {
    return undefined;
  }

  return trackonEventTime(rowDate(row), rowTime(row));
}
