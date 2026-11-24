export function displayName(person: {
  firstName?: string | null;
  lastName?: string | null;
}) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

export function relativeTime(
  iso: string | null | undefined,
  now = new Date(),
): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const elapsed = now.getTime() - then.getTime();
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (elapsed < 60_000) return format.format(0, "second");
  if (elapsed < 3_600_000) {
    return format.format(-Math.floor(elapsed / 60_000), "minute");
  }
  if (elapsed < 86_400_000) {
    return format.format(-Math.floor(elapsed / 3_600_000), "hour");
  }
  if (elapsed < 604_800_000) {
    return format.format(-Math.floor(elapsed / 86_400_000), "day");
  }
  if (elapsed < 2_592_000_000) {
    return format.format(-Math.floor(elapsed / 604_800_000), "week");
  }
  return then.toLocaleDateString("en", {
    day: "numeric",
    month: "long",
    year: now.getFullYear() === then.getFullYear() ? undefined : "numeric",
  });
}

export function deviceLabel(userAgent: string | null | undefined) {
  const ua = userAgent?.trim();
  if (!ua) return "Unknown device";
  if (!/[/(]/.test(ua) && ua.length < 48) return ua;

  const browser = (() => {
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
    return "Browser";
  })();

  const os = (() => {
    if (/iPhone|iPad/.test(ua)) return "iOS";
    if (/Android/.test(ua)) return "Android";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/Windows/.test(ua)) return "Windows";
    if (/Linux/.test(ua)) return "Linux";
    return null;
  })();

  return os ? `${browser} on ${os}` : browser;
}

export function isMobileAgent(userAgent: string | null | undefined) {
  return /Mobile|Android|iPhone|iPad/i.test(userAgent ?? "");
}

export function lastUsedLabel(
  iso: string | null | undefined,
  now = new Date(),
) {
  const when = relativeTime(iso, now);
  return when ? `Last used ${when}` : null;
}

export function sessionLocation(session: {
  currentLocation: { cityName: string; countryISOCode: string } | null;
  ipAddress: string | null;
}) {
  if (session.currentLocation) {
    return `${session.currentLocation.cityName}, ${session.currentLocation.countryISOCode}`;
  }
  return session.ipAddress ?? "Unknown location";
}
