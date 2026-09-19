/**
 * Every number that decides whether the shop owner gets interrupted.
 *
 * They live in one file because they are judgement calls, not facts, and
 * because tuning them during a demo should mean editing one place. Each one
 * is a tradeoff between a missed problem and a false alarm, and false alarms
 * are the expensive kind: a tool that flags every bill gets ignored, and then
 * it catches nothing at all.
 */

/**
 * A price has to move this much before it is worth mentioning. Supplier
 * prices drift by a few percent constantly, with packaging changes and
 * seasonal produce, and flagging that would bury the real jumps.
 */
export const PRICE_JUMP_FRACTION = 0.15;

/**
 * And it has to move at least this many rupees. Without this, a ₹4 item
 * going to ₹5 is a 25% rise and technically a flag, which is noise. The
 * percentage catches proportion, this catches significance.
 */
export const PRICE_JUMP_ABSOLUTE = 2;

/** Above this, a price move is worth stopping the write for, not just noting. */
export const PRICE_JUMP_HIGH_FRACTION = 0.4;

/**
 * Two bills whose totals are within this of each other are candidates for
 * being the same bill. Tight, because two genuinely different orders from the
 * same supplier in the same week can easily land within a few percent.
 */
export const DUPLICATE_TOTAL_FRACTION = 0.01;

/**
 * And they have to be dated within this many days. A supplier billing the
 * same amount a month apart is a standing order, not a double entry.
 */
export const DUPLICATE_WINDOW_DAYS = 7;

/** A payment this close is worth surfacing on the bill itself. */
export const DUE_SOON_DAYS = 7;
