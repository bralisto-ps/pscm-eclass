// Opens WhatsApp (app or web) with the message ready to send to a group.
export function shareWhatsApp(text) {
  const msg = `${text}\n\n${window.location.origin}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}
