export function mmToImperial(mm, fracDen=8){
  const inches = mm / 25.4;
  const feet = Math.floor(inches / 12);
  const remIn = inches - feet*12;
  const wholeIn = Math.floor(remIn + 1e-9);
  const frac = remIn - wholeIn;
  const num = Math.round(frac * fracDen);
  let adjWhole = wholeIn;
  let adjFeet = feet;
  let adjNum = num;
  if(adjNum === fracDen){ adjNum = 0; adjWhole += 1; }
  if(adjWhole === 12){ adjWhole = 0; adjFeet += 1; }
  const fracStr = adjNum ? ` ${adjNum}/${fracDen}` : "";
  const inchStr = `${adjWhole}${fracStr}"`;
  return `${adjFeet}'-${inchStr}`;
}

export function mmToMetric(mm){
  if(mm >= 1000) return `${(mm/1000).toFixed(2)} m`;
  return `${mm.toFixed(0)} mm`;
}
