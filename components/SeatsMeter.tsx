/*
 * How full an event is, drawn the way merchandise stock is drawn.
 *
 * The bar fills as registrations come in, so a glance down the column
 * finds the halls about to overflow. That is the inverse of the
 * inventory meter, which empties as caps sell -- both answer "how much
 * headroom is left", and both go red at the same end.
 */

import { capacityLevel } from "@/lib/capacity";

type Seats = {
  /* Undefined until supabase/event-capacity.sql runs. */
  capacity?: number | null;
  capacityNote?: string | null;
  /* Signed: negative means the event is past its cap. */
  seatsRemaining?: number | null;
  fillPercentage?: number | null;
  registrations: number;
};

export function SeatsMeter({ event }: { event: Seats }) {
  const capacity = event.capacity;

  /*
   * No figure in the sheet. Deliberately not drawn as an empty bar:
   * "we never wrote a number down" and "nobody has registered" look
   * identical that way, and only one of them is a problem.
   */
  if (capacity === null || capacity === undefined) {
    return (
      <span
        className="dim"
        title={
          event.capacityNote ??
          "The organisers' sheet gave no expected figure for this event"
        }
      >
        —
      </span>
    );
  }

  const left = Number(event.seatsRemaining ?? 0);
  const fill = Number(event.fillPercentage ?? 0);

  const level = capacityLevel(event);

  const over = level === "over";

  /*
   * Clamped for the bar only. The number beside it stays signed, so an
   * event 12 past its cap says so rather than sitting silently at 100%.
   */
  const width = Math.max(0, Math.min(100, fill));

  /*
   * Shared with the row highlight and the count beside the sort, so a
   * bar that has gone amber and a row with an amber edge always mean
   * the same thing.
   */
  const tone =
    level === "over"
      ? "meter-fill-danger"
      : level === "near"
        ? "meter-fill-warning"
        : "meter-fill-success";

  return (
    <div className="seats">
      <div
        className="meter-track"
        role="progressbar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${event.registrations} of ${capacity} seats taken`}
      >
        <div
          className={`meter-fill ${tone}`}
          style={{ width: `${width}%` }}
        />
      </div>

      <div className="meter-foot">
        <span className={over ? "seats-over" : undefined}>
          {over
            ? `${Math.abs(left)} over`
            : `${left} of ${capacity}`}
        </span>

        {/*
         * The sheet's own words, where it did not give a plain number
         * -- "15-20 teams" counts something other than seats, and the
         * cap alone would be read as twenty people.
         */}
        {event.capacityNote && (
          <span className="dim" title={event.capacityNote}>
            {event.capacityNote}
          </span>
        )}
      </div>
    </div>
  );
}
