"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { useLiveRefresh } from "@/lib/use-realtime";
import {
  AlertIcon,
  ArrowRightIcon,
  DownloadIcon,
  InboxIcon,
  SearchIcon,
} from "@/components/icons";
import { PRICING_LABEL, type Pricing } from "@/lib/event-pricing";
import { SeatsMeter } from "@/components/SeatsMeter";
import { capacityLevel } from "@/lib/capacity";

type EventSummary = {
  event_id: string;
  name: string;
  /* The day the event runs, e.g. "D1", "D1 + D2". */
  event_date: string | null;
  venue: string | null;
  registrations: number;
  participants: number;
  scanned: number;
  /* Admins only; the API omits it for coordinators. */
  revenue?: number;
  /* Resolved server-side so every screen agrees on the bucket. */
  pricingResolved: Pricing;
  pricingMixed?: boolean;
  /* Absent until supabase/external-registrations.sql runs. */
  externalRegistrations?: number;
  internalRegistrations?: number;
  unknownRegistrations?: number;
  /*
   * Absent until supabase/event-capacity.sql runs; null on an event the
   * organisers' sheet gave no figure for. Those two are different, and
   * neither means zero seats.
   */
  capacity?: number | null;
  capacityNote?: string | null;
  /* Signed: negative means the event is over its cap. */
  seatsRemaining?: number | null;
  fillPercentage?: number | null;
};

type PricingCounts = Record<Pricing, number>;

const LIVE_TABLES = ["registrations", "qr_scans", "events", "sync_log"];

const PRICING_TABS: { key: Pricing | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "free", label: "Free" },
  { key: "unclassified", label: "Unclassified" },
];

export default function EventsPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [scoped, setScoped] = useState(false);
  const [canSeeRevenue, setCanSeeRevenue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [canSetPricing, setCanSetPricing] = useState(false);
  const [pricingTab, setPricingTab] = useState<Pricing | "all">("all");

  /*
   * Separate from the pricing tabs on purpose. "Paid / free" and "has
   * anybody signed up" are different questions, and folding the second
   * into the first row would mean you could not ask both at once --
   * which is exactly the combination worth asking two days out.
   */
  const [onlyEmpty, setOnlyEmpty] = useState(false);

  /*
   * Fullest first by default.
   *
   * The list arrives ordered by registrations, which puts the biggest
   * events on top -- but "big" and "about to overflow" are different
   * things. An event 135% full with 54 people is the one somebody has
   * to act on; an event with 146 registrations against 210 seats is
   * fine. Sorting by pressure rather than by size puts the problems
   * where they are seen.
   */
  const [sortMode, setSortMode] = useState<"fill" | "size">("fill");
  const [saving, setSaving] = useState("");

  const [counts, setCounts] = useState<PricingCounts>({
    paid: 0,
    free: 0,
    unclassified: 0,
  });

  const [originAvailable, setOriginAvailable] = useState(false);
  const [capacityAvailable, setCapacityAvailable] = useState(false);

  const loadEvents = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);

    try {
      const response = await fetch("/api/events", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load events");
      }

      setEvents(data.events ?? []);
      setScoped(Boolean(data.scoped));
      setCanSeeRevenue(Boolean(data.canSeeRevenue));
      setCanSetPricing(Boolean(data.canSetPricing));

      if (data.pricingCounts) {
        setCounts(data.pricingCounts);
      }

      setOriginAvailable(Boolean(data.originAvailable));
      setCapacityAvailable(Boolean(data.capacityAvailable));

      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load events"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadEvents(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEvents]);

  const live = useLiveRefresh(
    LIVE_TABLES,
    useCallback(() => loadEvents(true), [loadEvents])
  );

  /*
   * Filtering is local so typing stays responsive. The API accepts
   * the same `q` and applies it server-side too, which is what keeps
   * a coordinator from ever receiving another club's rows.
   */
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    const rows = events.filter((event) => {
      if (
        pricingTab !== "all" &&
        event.pricingResolved !== pricingTab
      ) {
        return false;
      }

      if (onlyEmpty && Number(event.registrations ?? 0) > 0) {
        return false;
      }

      if (!query) return true;

      return (
        event.name.toLowerCase().includes(query) ||
        String(event.event_id).toLowerCase().includes(query)
      );
    });

    if (sortMode === "size") return rows;

    /*
     * An event with no capacity recorded has no pressure to sort by,
     * so it falls below everything that does and keeps its own order
     * by size. Treating "unknown" as 0% would bury the 8 events whose
     * figure the sheet never gave among the genuinely empty ones.
     */
    return [...rows].sort((a, b) => {
      const fill = (event: EventSummary) =>
        event.capacity === null || event.capacity === undefined
          ? null
          : Number(event.fillPercentage ?? 0);

      const left = fill(a);
      const right = fill(b);

      if (left === null && right === null) {
        return Number(b.registrations ?? 0) - Number(a.registrations ?? 0);
      }

      if (left === null) return 1;
      if (right === null) return -1;

      return (
        right - left ||
        Number(b.registrations ?? 0) - Number(a.registrations ?? 0)
      );
    });
  }, [events, search, pricingTab, onlyEmpty, sortMode]);

  /* How many need looking at, regardless of the current filters. */
  const pressure = useMemo(() => {
    let over = 0;
    let near = 0;

    for (const event of events) {
      const level = capacityLevel(event);

      if (level === "over") over += 1;
      else if (level === "near") near += 1;
    }

    return { over, near };
  }, [events]);

  const emptyCount = useMemo(
    () =>
      events.filter(
        (event) => Number(event.registrations ?? 0) === 0
      ).length,
    [events]
  );

  /*
   * Totals follow the visible tab. Reading "Revenue" while the Free
   * tab is open and seeing the paid events' money would be worse
   * than useless.
   */
  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, event) => {
          acc.registrations += Number(event.registrations ?? 0);
          acc.scanned += Number(event.scanned ?? 0);
          acc.revenue += Number(event.revenue ?? 0);
          acc.external += Number(event.externalRegistrations ?? 0);
          acc.unknown += Number(event.unknownRegistrations ?? 0);
          return acc;
        },
        {
          registrations: 0,
          scanned: 0,
          revenue: 0,
          external: 0,
          unknown: 0,
        }
      ),
    [filtered]
  );

  /*
   * Only ever needed for events with no registrations. Once tickets
   * sell, the totals classify the event and this override should be
   * cleared rather than fought with.
   */
  async function setPricing(
    eventId: string,
    pricing: Pricing | null
  ) {
    if (saving) return;

    setSaving(eventId);
    setError("");

    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pricing: pricing === "unclassified" ? null : pricing,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to update event");
      }

      await loadEvents(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update event"
      );
    } finally {
      setSaving("");
    }
  }

  const scopeLabel =
    pricingTab === "all"
      ? "All listed events"
      : `${PRICING_LABEL[pricingTab]} events only`;

  const formatAmount = (amount: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <main className="app">
      <NavBar />

      <div className="container">

        <header className="page-header">
          <div>
            <span className="page-eyebrow">
              V-TAPP / {scoped ? "Your events" : "Events"}
            </span>

            <h1 className="page-title">
              {scoped ? "Your Events" : "All Events"}
            </h1>

            <p className="page-subtitle">
              {scoped
                ? "The events you coordinate"
                : "Every event, with registrations and check-in progress"}
            </p>
          </div>

          <div className="header-actions">
            <span
              className={`pulse${
                live === "live" ? "" : " pulse-idle"
              }`}
            >
              {live === "live" ? "Live" : "Polling"}
            </span>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => loadEvents(true)}
              disabled={refreshing}
            >
              {refreshing && <span className="btn-spinner" />}
              {refreshing ? "Refreshing" : "Refresh"}
            </button>


          </div>
        </header>

        {error && (
          <div className="banner banner-danger" role="alert">
            <AlertIcon size={18} />
            <span>{error}</span>
          </div>
        )}

        {!loading && events.length > 0 && (
          <section className="stat-grid">
            <div className="stat stat-feature">
              <span className="stat-label">Events</span>
              <strong className="stat-value">{events.length}</strong>
              <span className="stat-meta">
                {counts.paid} paid · {counts.free} free
                {counts.unclassified > 0
                  ? ` · ${counts.unclassified} unclassified`
                  : ""}
              </span>
            </div>

            <div className="stat">
              <span className="stat-label">Registrations</span>
              <strong className="stat-value">
                {totals.registrations}
              </strong>
              <span className="stat-meta">{scopeLabel}</span>
            </div>

            <div className="stat">
              <span className="stat-label">Checked in</span>
              <strong className="stat-value stat-success">
                {totals.scanned}
              </strong>
              <span className="stat-meta">QR codes scanned</span>
            </div>

            {originAvailable && (
              <div className="stat">
                <span className="stat-label">External</span>

                <strong className="stat-value">
                  {totals.external}
                </strong>

                {/* The unknown count is shown next to the figure, not
                    hidden, because it is what says how far the figure
                    can be trusted before it is shared. */}
                <span className="stat-meta">
                  {totals.registrations > 0
                    ? `${Math.round(
                        (totals.external / totals.registrations) * 100
                      )}% of registrations`
                    : "No registrations"}
                  {totals.unknown > 0
                    ? ` · ${totals.unknown} unconfirmed`
                    : ""}
                </span>
              </div>
            )}

            {canSeeRevenue && (
              <div className="stat">
                <span className="stat-label">Revenue</span>
                <strong className="stat-value">
                  {formatAmount(totals.revenue)}
                </strong>
                <span className="stat-meta">{scopeLabel}</span>
              </div>
            )}
          </section>
        )}

        <section className="panel">
          <div className="panel-header">
            <div
              className="segmented"
              role="group"
              aria-label="Filter events by price"
            >
              {PRICING_TABS.map((tab) => {
                const total =
                  tab.key === "all"
                    ? events.length
                    : counts[tab.key];

                return (
                  <button
                    key={tab.key}
                    type="button"
                    className="segmented-item"
                    aria-pressed={pricingTab === tab.key}
                    onClick={() => setPricingTab(tab.key)}
                  >
                    {tab.label}
                    <span className="segmented-count">{total}</span>
                  </button>
                );
              })}
            </div>

            {/*
              A separate control, because "nobody has signed up" is a
              different question from "paid or free" and you want to
              ask both at once two days out.
            */}
            <div className="events-tools">
              <label className="check">
                <input
                  type="checkbox"
                  checked={onlyEmpty}
                  onChange={(event) =>
                    setOnlyEmpty(event.target.checked)
                  }
                />

                <span>
                  No registrations
                  <span className="segmented-count">
                    {emptyCount}
                  </span>
                </span>
              </label>

              {capacityAvailable && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={sortMode === "fill"}
                    onChange={(event) =>
                      setSortMode(
                        event.target.checked ? "fill" : "size"
                      )
                    }
                  />

                  <span>
                    Fullest first
                    {(pressure.over > 0 || pressure.near > 0) && (
                      <span
                        className="segmented-count"
                        title={`${pressure.over} over capacity, ${pressure.near} at 85% or more`}
                      >
                        {pressure.over > 0 && (
                          <span className="seats-over">
                            {pressure.over} over
                          </span>
                        )}
                        {pressure.over > 0 &&
                          pressure.near > 0 &&
                          " · "}
                        {pressure.near > 0 &&
                          `${pressure.near} near`}
                      </span>
                    )}
                  </span>
                </label>
              )}

              <a
                className="btn btn-ghost btn-sm"
                href={`/api/events/export${
                  onlyEmpty ? "?filter=empty" : ""
                }`}
                /*
                 * A plain link, not a fetch-and-blob. The server sets
                 * Content-Disposition, so the browser saves it with
                 * the right name and never holds a megabyte of
                 * spreadsheet in memory on a phone.
                 */
                download
              >
                <DownloadIcon size={13} />
                Download {onlyEmpty ? emptyCount : filtered.length} as
                Excel
              </a>
            </div>
          </div>

          <div className="panel-header">
            <div className="search" style={{ flex: "1 1 280px" }}>
              <span className="search-icon">
                <SearchIcon size={16} />
              </span>

              <label className="sr-only" htmlFor="event-search">
                Search events
              </label>

              <input
                id="event-search"
                type="search"
                className="input"
                placeholder="Search events by name or ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {!loading && (
              <span className="muted text-sm">
                {filtered.length} of {events.length}
              </span>
            )}
          </div>

          {loading ? (
            <div className="panel-body stack">
              {[1, 2, 3].map((row) => (
                <div key={row}>
                  <div className="skeleton skeleton-line" />
                  <div
                    className="skeleton skeleton-line"
                    style={{ width: "40%" }}
                  />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <InboxIcon size={22} />
              </div>

              <p className="empty-title">
                {events.length === 0
                  ? scoped
                    ? "No events assigned to you yet"
                    : "No events yet"
                  : pricingTab === "all"
                    ? "Nothing matches that search"
                    : `No ${PRICING_LABEL[
                        pricingTab
                      ].toLowerCase()} events here`}
              </p>

              <p className="empty-body">
                {events.length === 0
                  ? scoped
                    ? "An administrator needs to assign you an event before it appears here."
                    : "Events appear here after a V-TAPP sync brings registrations in."
                  : pricingTab === "all"
                    ? "Try a different name or event ID."
                    : "Switch to All, or widen the search."}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">
                  Events with registration and check-in totals
                </caption>

                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Price</th>
                    <th scope="col" className="table-num">
                      Registrations
                    </th>
                    <th scope="col" className="table-num">
                      Participants
                    </th>
                    <th scope="col" className="table-num">
                      Checked in
                    </th>
                    {capacityAvailable && (
                      <th scope="col">Seats left</th>
                    )}
                    {originAvailable && (
                      <th scope="col" className="table-num">
                        External
                      </th>
                    )}
                    {canSeeRevenue && (
                      <th scope="col" className="table-num">
                        Revenue
                      </th>
                    )}
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((event) => {
                    const registrations = Number(
                      event.registrations ?? 0
                    );

                    const scanned = Number(event.scanned ?? 0);

                    const percent =
                      registrations > 0
                        ? Math.round((scanned / registrations) * 100)
                        : 0;

                    /*
                     * Sorting alone is not a signal: the top row is the
                     * top row whether it is 135% full or 4%. A coloured
                     * left edge says which, and survives the list being
                     * re-sorted by size.
                     */
                    const level = capacityLevel(event);

                    const over = level === "over";
                    const near = level === "near";

                    return (
                      <tr
                        key={event.event_id}
                        className={
                          over
                            ? "row-over"
                            : near
                              ? "row-near"
                              : undefined
                        }
                      >
                        <td>
                          <div className="row-title">
                            {event.name}
                          </div>

                          <div className="row-meta">
                            {[event.event_date, event.venue]
                              .filter(Boolean)
                              .join(" · ") || "No schedule recorded"}
                          </div>
                        </td>

                        <td>
                          {canSetPricing ? (
                            <>
                              <label
                                className="sr-only"
                                htmlFor={`pricing-${event.event_id}`}
                              >
                                Price for {event.name}
                              </label>

                              <select
                                id={`pricing-${event.event_id}`}
                                className="select select-sm"
                                value={event.pricingResolved}
                                disabled={saving === event.event_id}
                                onChange={(change) =>
                                  setPricing(
                                    event.event_id,
                                    change.target.value as Pricing
                                  )
                                }
                              >
                                <option value="paid">Paid</option>
                                <option value="free">Free</option>
                                <option value="unclassified">
                                  Unclassified
                                </option>
                              </select>

                              {event.pricingMixed && (
                                <div className="row-meta">
                                  Mixed tiers
                                </div>
                              )}
                            </>
                          ) : (
                            <span
                              className={`badge ${
                                event.pricingResolved === "paid"
                                  ? "badge-accent"
                                  : event.pricingResolved === "free"
                                    ? "badge-success"
                                    : "badge-plain"
                              }`}
                            >
                              {PRICING_LABEL[event.pricingResolved]}
                            </span>
                          )}
                        </td>

                        <td className="table-num">{registrations}</td>

                        <td className="table-num">
                          {event.participants}
                        </td>

                        <td className="table-num">
                          {scanned}
                          <span className="dim"> ({percent}%)</span>
                        </td>

                        {capacityAvailable && (
                          <td>
                            <SeatsMeter event={event} />
                          </td>
                        )}

                        {originAvailable && (
                          <td className="table-num">
                            {Number(event.externalRegistrations ?? 0)}

                            {Number(event.unknownRegistrations ?? 0) >
                              0 && (
                              <span
                                className="dim"
                                title={`${event.unknownRegistrations} registrations name no university and have no VIT-AP address, so they could be either`}
                              >
                                {" "}
                                (+{event.unknownRegistrations}?)
                              </span>
                            )}
                          </td>
                        )}

                        {canSeeRevenue && (
                          <td className="table-num">
                            {formatAmount(Number(event.revenue ?? 0))}
                          </td>
                        )}

                        <td className="table-num">
                          <Link
                            href={`/events/${encodeURIComponent(
                              event.event_id
                            )}`}
                            className="btn btn-ghost btn-sm"
                          >
                            Open
                            <ArrowRightIcon size={13} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
