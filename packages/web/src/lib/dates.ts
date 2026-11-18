import { parseServerDate } from "@devgym/shared";

const dayTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayLong = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
const dayFull = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** The service stores UTC; these show it in the developer's own time zone. */
export const formatDayTime = (text: string) => dayTime.format(parseServerDate(text));
export const formatDay = (text: string) => dayLong.format(parseServerDate(text));
export const formatFullDay = (text: string) => dayFull.format(parseServerDate(text));
export const formatTime = (text: string) => time.format(parseServerDate(text));
export const isoDate = (text: string) => parseServerDate(text).toISOString();
