// Checks for POST /admin/attach-awb: attaching, by hand, the AWB of a
// booking Trackon made but never confirmed (for example after a timeout).
export function attachAwbProblem({ awb, shipment }) {
  const value = String(awb ?? "").trim();

  if (!/^\d{10,15}$/.test(value)) {
    return "AWB must be 10 to 15 digits.";
  }

  if (!shipment?.orderGid) {
    return "No shipment record for this order ID. Only orders the service tried to book can have an AWB attached.";
  }

  if (shipment.awb) {
    return `This order already has AWB ${shipment.awb}; it is never overwritten.`;
  }

  if (shipment.shopifyCancelled) {
    return "This order is cancelled in Shopify.";
  }

  return null;
}
