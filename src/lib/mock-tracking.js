// Development only: fake Trackon scans so every tracking step can be tested
// against a dev store without a real courier. The reply copies the live
// shape for our customer-code account: summaryTrack is null and the current
// status is in CustomersummaryTrack.

// Descriptions from Trackon's tracking API track-code table.
const TRACK_CODE_DESCRIPTIONS = {
  RPRU: "REQUEST RAISED FOR REVERSE/PICKUP",
  PRSG: "PRS PREPARED",
  PRSS: "PICKUP SUCESSFUL",
  PRSN: "S/MENT FAILED TO PICKUP DUE TO SHIPPER NOT AVAILABLE",
  RPRS: "REQUEST RAISED FOR REVERSE/PICKUP",
  RPSS: "RETURN S/MENT PICKED UP AND BOOKING PROCESSED",
  RPSN: "REVERSE S/MENT FAILED TO PICKUP",
  BOKN: "S/MENT BOOKED",
  BOKD: "S/MENT BOOKED",
  SPHO: "IN TRANSIT FROM",
  MFTD: "PROCESSING BAG",
  MFTF: "PROCESSING BAG",
  MMFT: "PROCESSING BAG",
  VFWD: "IN TRANSIT",
  CDOT: "IN TRANSIT",
  CDIN: "ARRIVED BAG AT LOCATION",
  CDIE: "ARRIVED BAG AT LOCATION",
  IMMF: "ARRIVED BAG AT LOCATION",
  VMMF: "ARRIVED BAG AT LOCATION",
  IMFT: "PROCESSING AT HUB",
  IMFE: "PROCESSING AT HUB",
  IMFS: "PROCESSING AT HUB",
  IMFD: "PROCESSING AT HUB",
  ISMT: "S/MENT ARRIVED",
  ISMD: "S/MENT RECEIVED",
  ISTE: "S/MENT ARRIVED",
  ISDE: "S/MENT RECEIVED",
  ISMS: "S/MENT ARRIVED, INVESTIGATION OF S/MENT UNDER PROCESS",
  ISDD: "S/MENT ARRIVED, INVESTIGATION OF S/MENT UNDER PROCESS",
  ISSS: "S/MENT ARRIVED, INVESTIGATION OF S/MENT UNDER PROCESS",
  MIRT: "MISROUTE",
  MIRB: "MISROUTE",
  DRSG: "OUT FOR DELIVERY",
  DRMG: "IN TRANSIT TO HUB",
  DRBG: "DELIVERY MANIFEST PREPARED",
  DRSF: "OUT FOR DELIVERY",
  DDUB: "DELIVERED",
  DDUF: "DELIVERED",
  DDUA: "DELIVERED",
  DNUB: "UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE",
  DNUF: "UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE",
  DNUA: "UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE",
  RSET: "S/MENT MARKED FOR RTO DUE TO CUSTOMER REFUSED",
  RMFT: "PROCESSING RTO BAG",
  RIST: "RTO S/MENT ARRIVED",
  RISR: "RTO S/MENT RECEIVED",
  RITE: "RTO S/MENT ARRIVED",
  RIRE: "RTO S/MENT RECEIVED",
  RHOB: "RTO OUT FOR DELIVERY",
  RHOD: "RTO DELIVERED",
  RHON: "RTO UNDELIVERED",
  HELD: "INVESTIGATION OF S/MENT UNDER PROCESS",
  RELE: "S/MENT RELEASED & PROCESSED",
};

export const MOCK_TRACK_CODES = Object.keys(TRACK_CODE_DESCRIPTIONS);

const istParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function buildMockScan({ code, status, city, at = new Date() }) {
  const trackingCode = String(code || "").trim().toUpperCase();

  if (!TRACK_CODE_DESCRIPTIONS[trackingCode]) {
    throw new Error(`Unknown Trackon tracking code: ${trackingCode || "(empty)"}`);
  }

  const [date, time] = istParts.format(at).split(", ");

  return {
    CURRENT_CITY: String(city || "MOCK HUB").trim(),
    CURRENT_STATUS:
      String(status || "").trim() || TRACK_CODE_DESCRIPTIONS[trackingCode],
    EVENTDATE: date,
    EVENTTIME: time,
    TRACKING_CODE: trackingCode,
  };
}

export function buildMockTrackingResponse(awb, scans = []) {
  const list = Array.isArray(scans) ? scans : [];
  const latest = list[list.length - 1];

  const summary = latest
    ? { ...latest }
    : {
        CURRENT_STATUS: "MOCK - SHIPMENT BOOKED",
        CURRENT_CITY: "",
        TRACKING_CODE: "BOKN",
        // No scan time without scans, so polls do not add a history line.
        EVENTDATE: "",
        EVENTTIME: "",
      };

  return {
    summaryTrack: null,
    CustomersummaryTrack: {
      AWBNO: String(awb),
      NDR_REASON: "",
      ...summary,
    },
    lstDetails: [...list].reverse(),
    ResponseStatus: { ErrorCode: null, Message: "SUCCESS", Errors: null },
  };
}
