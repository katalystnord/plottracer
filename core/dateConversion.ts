/**
 * Faithful TypeScript port of wpd-core's core/dateConversion.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See core/mathFunctions.ts for porting-provenance notes.
 *
 * Ported in full even though it's not in core/'s primary calibration-math
 * path — inputParser.ts has a hard dependency on it (date-formatted axis
 * values), confirmed while reading the original source. See CLAUDE.md's
 * "Current scoped task" note anticipating exactly this.
 */

function toJD(dateStringInput: string): number | null {
  const dateString = dateStringInput.toString();
  const dateParts = dateString.split(/[/ :]/);
  const hasDatePart = dateString.indexOf('/') >= 0;
  let year: number, month: number, date: number, timeIdxOffset: number;

  if (dateParts.length <= 0 || dateParts.length > 6) {
    return null;
  }

  if (hasDatePart) {
    year = parseInt(dateParts[0]!, 10);
    month = parseInt(dateParts[1] === undefined ? '0' : dateParts[1], 10);
    date = parseInt(dateParts[2] === undefined ? '1' : dateParts[2], 10);
    timeIdxOffset = 3;
  } else {
    const today = new Date();
    year = today.getFullYear();
    month = today.getMonth() + 1;
    date = today.getDate();
    timeIdxOffset = 0;
  }
  const hourPart = dateParts[timeIdxOffset];
  const minPart = dateParts[timeIdxOffset + 1];
  const hour = parseInt(hourPart === undefined ? '0' : hourPart, 10);
  const min = parseInt(minPart === undefined ? '0' : minPart, 10);

  let sec: number, msec: number;
  const hasSec = dateParts[timeIdxOffset + 2] !== undefined;
  if (hasSec) {
    const secPart = dateParts[timeIdxOffset + 2]!;
    const fval = parseFloat(secPart);
    sec = parseInt(String(fval), 10);
    if (fval - sec >= 0.001 && secPart.indexOf('.') >= 0) {
      msec = parseInt(String(parseFloat('.' + secPart.split('.')[1]) * 1000), 10);
    } else {
      msec = 0;
    }
  } else {
    sec = 0;
    msec = 0;
  }

  if (isNaN(year) || isNaN(month) || isNaN(date) || isNaN(hour) || isNaN(min) || isNaN(sec)) {
    return null;
  }
  if (month > 12 || month < 1) return null;
  if (date > 31 || date < 1) return null;
  if (hour > 23 || hour < 0) return null;
  if (min > 59 || min < 0) return null;
  if (sec > 59 || sec < 0) return null;
  if (msec > 1000 || msec < 0) return null;

  const tempDate = new Date();
  tempDate.setUTCFullYear(year);
  tempDate.setUTCMonth(month - 1);
  tempDate.setUTCDate(date);
  tempDate.setUTCHours(hour, min, sec, msec);
  const rtnValue = parseFloat(String(tempDate.getTime()));
  if (!isNaN(rtnValue)) {
    return rtnValue;
  }
  return null;
}

export function parse(input: unknown): number | null {
  if (input == null) {
    return null;
  }
  if (typeof input === 'string') {
    if (input.indexOf('/') < 0 && input.indexOf(':') < 0) {
      return null;
    }
  }
  return toJD(String(input));
}

function formatDate(dateObject: Date, formatString: string): string {
  const longMonths: string[] = [];
  const shortMonths: string[] = [];
  const tmpDate = new Date('1/1/2021');

  for (let i = 0; i < 12; i++) {
    tmpDate.setUTCMonth(i);
    longMonths.push(tmpDate.toLocaleString(undefined, { month: 'long' }));
    shortMonths.push(tmpDate.toLocaleString(undefined, { month: 'short' }));
  }

  let outputString = formatString;
  outputString = outputString.replace('YYYY', 'yyyy');
  outputString = outputString.replace('YY', 'yy');
  outputString = outputString.replace('MMMM', 'mmmm');
  outputString = outputString.replace('MMM', 'mmm');
  outputString = outputString.replace('MM', 'mm');
  outputString = outputString.replace('DD', 'dd');
  outputString = outputString.replace('HH', 'hh');
  outputString = outputString.replace('II', 'ii');
  outputString = outputString.replace('SS', 'ss');
  outputString = outputString.replace('.FRAC', '.frac');

  outputString = outputString.replace('yyyy', String(dateObject.getUTCFullYear()));

  const twoDigitYearNum = dateObject.getUTCFullYear() % 100;
  const twoDigitYear = twoDigitYearNum < 10 ? '0' + twoDigitYearNum : String(twoDigitYearNum);
  outputString = outputString.replace('yy', twoDigitYear);

  outputString = outputString.replace('mmmm', longMonths[dateObject.getUTCMonth()]!);
  outputString = outputString.replace('mmm', shortMonths[dateObject.getUTCMonth()]!);
  outputString = outputString.replace('mm', ('0' + (dateObject.getUTCMonth() + 1)).slice(-2));
  outputString = outputString.replace('dd', ('0' + dateObject.getUTCDate()).slice(-2));

  outputString = outputString.replace('hh', ('0' + dateObject.getUTCHours()).slice(-2));
  outputString = outputString.replace('ii', ('0' + dateObject.getUTCMinutes()).slice(-2));
  const secStr = ('0' + dateObject.getUTCSeconds()).slice(-2);
  const milliStr = ('00' + dateObject.getUTCMilliseconds()).slice(-3);
  outputString = outputString.replace('ss.frac', secStr + '.' + milliStr);
  outputString = outputString.replace('ss', secStr);

  return outputString;
}

export function formatDateNumber(dateNumber: number, formatString: string): string {
  let coeff = 1;
  if (formatString.indexOf('frac') >= 0) coeff = 1.0;
  else if (formatString.indexOf('s') >= 0) coeff = 1000;
  else if (formatString.indexOf('i') >= 0) coeff = 1000 * 60;
  else if (formatString.indexOf('h') >= 0) coeff = 1000 * 60 * 60;
  else if (formatString.indexOf('d') >= 0) coeff = 1000 * 60 * 60 * 24;
  else if (formatString.indexOf('m') >= 0) coeff = 1.0;
  else if (formatString.indexOf('y') >= 0) coeff = 1.0;

  return formatDate(
    new Date(Math.round(new Date(dateNumber).getTime() / coeff) * coeff),
    formatString
  );
}

export function getFormatString(dateString: string): string {
  const dateParts = dateString.split(/[/ :]/);
  const hasDatePart = dateString.indexOf('/') >= 0;
  let formatString = 'yyyy/mm/dd hh:ii:ss';

  if (dateParts.length >= 1) {
    formatString = hasDatePart ? 'yyyy' : 'hh';
  }
  if (dateParts.length >= 2) {
    formatString += hasDatePart ? '/mm' : ':ii';
  }
  if (dateParts.length >= 3) {
    formatString += hasDatePart ? '/dd' : ':ss';
  }
  if (dateParts.length >= 4) {
    formatString += ' hh';
  }
  if (dateParts.length >= 5) {
    formatString += ':ii';
  }
  if (dateParts.length === 6) {
    formatString += ':ss';
  }
  return formatString;
}
