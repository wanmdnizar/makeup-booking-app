// Shared by the studio and the client ticket. Dates and clock times are studio-local.
export const minutes = time => Number(time.slice(0,2))*60 + Number(time.slice(3,5));
export const clock = value => [Math.floor(value/60),value%60].map(n=>String(n).padStart(2,'0')).join(':');
export const cents = value => Math.round(Number(value || 0)*100);
export function depositMet(booking) {
  return booking.depositRequired == null ? cents(booking.depositPaid)>0 :
    cents(booking.depositPaid)>=cents(booking.depositRequired);
}
export function fitsHours(settings,date,start,end) {
  const day = new Date(date+'T12:00:00').getDay();
  const rule = settings.workingHours?.[day];
  if (rule && (rule.closed || start<minutes(rule.start) || end>minutes(rule.end))) return false;
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
