// Studio-local clock times. Prices and payments are compared in integer cents.
export const minutes = time => Number(time.slice(0,2))*60 + Number(time.slice(3,5));
export const clock = value => [Math.floor(value/60),value%60].map(n=>String(n).padStart(2,'0')).join(':');
export const cents = value => Math.round(Number(value || 0)*100);
export function depositMet(booking) {
  return booking.depositRequired == null ? cents(booking.depositPaid)>0 :
    cents(booking.depositPaid)>=cents(booking.depositRequired);
}

export function overlapsAppointment(start,end,otherStart,otherEnd,buffer) {
  return start < otherEnd + buffer && end + buffer > otherStart;
}

export function fitsHours(settings,date,start,end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start || end>=1440) return false;
  const weekday = new Date(date+'T12:00:00').getDay();
  const hours = settings.workingHours?.[weekday];
  if (hours) {
    if (hours.closed || start<minutes(hours.start) || end>minutes(hours.end)) return false;
  } else if (start<300 || start>1140) {
    return false; // The default public calendar offers starts from 5 AM through 7 PM.
  }
  return !(settings.timeBlocks || []).some(b=>b.date===date && start<minutes(b.end) && end>minutes(b.start));
}

export function catalogueQuote(request,catalogue) {
  const base = catalogue.find(p=>p.id===request.packageId && !p.addon);
  if (!base) throw new Error('Choose a current package for this request.');
  const extras = (request.addons || []).filter(a=>!(/\b(transport|mileage|travel|petrol|parking|toll)\b/i).test(a.name));
  const addons = extras.map(a=>{
    const matches = catalogue.filter(p=>p.addon && (a.id ? p.id===a.id : p.name===a.name));
    if (matches.length!==1) throw new Error('Review add-ons and choose current catalogue items before approval.');
    return matches[0];
  });
  if (new Set(addons.map(a=>a.id)).size!==addons.length) throw new Error('Review duplicate add-ons before approval.');
  return {base,addons,serviceTotal:(cents(base.price)+addons.reduce((n,a)=>n+cents(a.price),0))/100,
    duration:Math.max(30,Number(base.durationMins)||120)+addons.reduce((n,a)=>n+Number(a.durationMins||0),0)};
}
export function clientCalendarUrl(booking) {
  const stamp=time=>booking.eventDate.replaceAll('-','')+'T'+time.replace(':','')+'00';
  const end=booking.endTime || clock(minutes(booking.startTime)+booking.durationMins);
  const params=new URLSearchParams({action:'TEMPLATE',text:booking.packageName,dates:stamp(booking.startTime)+'/'+stamp(end),
    ctz:'Asia/Kuala_Lumpur',location:booking.venue||''});
  return 'https://calendar.google.com/calendar/render?'+params;
}

// Accept a shared Google Maps pin, or let the caller use the written address.
export function googleMapsPin(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    const domain = url.hostname.toLowerCase();
    const valid = domain === 'maps.app.goo.gl' ||
      (domain === 'goo.gl' && url.pathname.startsWith('/maps/')) ||
      ['maps.google.com', 'maps.google.com.my'].includes(domain) ||
      (['google.com','www.google.com','google.com.my','www.google.com.my'].includes(domain) &&
        /^\/maps(?:\/|$)/.test(url.pathname));
    if (!valid) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}
export function directionsUrl(venue, pin) {
  return googleMapsPin(pin) || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(venue || '');
}
