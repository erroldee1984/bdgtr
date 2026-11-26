import { type CreateTransactionInput, type Transaction, type UpdateTransactionInput, yearMonthOf } from '@bdgtr/shared';
import { type Db, MongoServerError, ObjectId } from 'mongodb';

/** docs/PLAN.md §4. */
export interface TransactionDoc {
  _id: ObjectId;
  householdId: ObjectId;
  /** UUID from the app: unique per household, so a retried save is idempotent. */
  clientId: string;
  /** Calendar date in Manila, YYYY-MM-DD. */
  date: string;
  yearMonth: string;
  categoryId: ObjectId;
  amountMinor: number;
  description: string | null;
  source: 'manual' | 'fixed-auto' | 'fixed-bulk';
  /** The fixed transaction this was posted from (auto-post or bulk add). */
  fixedTransactionId?: ObjectId | null;
  createdBy: ObjectId;
  /** When the server received it. */
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const TRANSACTIONS = 'transactions';

export async function ensureTransactionIndexes(db: Db): Promise<void> {
  await db.collection<TransactionDoc>(TRANSACTIONS).createIndexes([
    { key: { householdId: 1, clientId: 1 }, unique: true, name: 'household_clientId_unique' },
    { key: { householdId: 1, yearMonth: 1, date: 1 }, name: 'household_month_date' },
    { key: { householdId: 1, yearMonth: 1, categoryId: 1 }, name: 'household_month_category' },
  ]);
}

export function toTransaction(doc: TransactionDoc, callerId: ObjectId): Transaction {
  return {
    id: doc._id.toHexString(),
    clientId: doc.clientId,
    date: doc.date,
    yearMonth: doc.yearMonth,
    categoryId: doc.categoryId.toHexString(),
    amountMinor: doc.amountMinor,
    description: doc.description,
    createdBy: doc.createdBy.toHexString(),
    isYours: doc.createdBy.equals(callerId),
  };
}

/**
 * Saves a spend. If this household already has one with the same clientId
 * (a retry), returns that original instead and `created: false`.
 */
export async function createTransaction(
  db: Db,
  householdId: ObjectId,
  input: CreateTransactionInput,
  by: ObjectId,
  now: Date,
  from: { source: TransactionDoc['source']; fixedTransactionId: ObjectId | null } = { source: 'manual', fixedTransactionId: null },
): Promise<{ doc: TransactionDoc; created: boolean }> {
  const coll = db.collection<TransactionDoc>(TRANSACTIONS);
  const doc: TransactionDoc = {
    _id: new ObjectId(),
    householdId,
    clientId: input.clientId,
    date: input.date,
    yearMonth: yearMonthOf(input.date),
    categoryId: new ObjectId(input.categoryId),
    amountMinor: input.amountMinor,
    description: input.description ?? null,
    source: from.source,
    fixedTransactionId: from.fixedTransactionId,
    createdBy: by,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await coll.insertOne(doc);
    return { doc, created: true };
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      const original = await coll.findOne({ householdId, clientId: input.clientId });
      if (original) return { doc: original, created: false };
    }
    throw err;
  }
}

export async function findTransaction(db: Db, householdId: ObjectId, id: ObjectId): Promise<TransactionDoc | null> {
  return db.collection<TransactionDoc>(TRANSACTIONS).findOne({ _id: id, householdId });
}

export async function listTransactions(db: Db, householdId: ObjectId, yearMonth: string): Promise<TransactionDoc[]> {
  return db
    .collection<TransactionDoc>(TRANSACTIONS)
    .find({ householdId, yearMonth })
    .sort({ date: -1, createdAt: -1 })
    .toArray();
}

export async function updateTransaction(
  db: Db,
  householdId: ObjectId,
  id: ObjectId,
  input: UpdateTransactionInput,
  now: Date,
): Promise<TransactionDoc | null> {
  const set: Partial<TransactionDoc> = { updatedAt: now };
  if (input.date !== undefined) {
    set.date = input.date;
    set.yearMonth = yearMonthOf(input.date);
  }
  if (input.categoryId !== undefined) set.categoryId = new ObjectId(input.categoryId);
  if (input.amountMinor !== undefined) set.amountMinor = input.amountMinor;
  if (input.description !== undefined) set.description = input.description;
  return db
    .collection<TransactionDoc>(TRANSACTIONS)
    .findOneAndUpdate({ _id: id, householdId }, { $set: set }, { returnDocument: 'after' });
}

export async function deleteTransaction(db: Db, householdId: ObjectId, id: ObjectId): Promise<boolean> {
  const res = await db.collection<TransactionDoc>(TRANSACTIONS).deleteOne({ _id: id, householdId });
  return res.deletedCount === 1;
}

/** Total spent per category id (hex) in a month. */
export async function spentByCategory(db: Db, householdId: ObjectId, yearMonth: string): Promise<Map<string, number>> {
  const rows = await db
    .collection<TransactionDoc>(TRANSACTIONS)
    .aggregate<{ _id: ObjectId; total: number }>([
      { $match: { householdId, yearMonth } },
      { $group: { _id: '$categoryId', total: { $sum: '$amountMinor' } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [r._id.toHexString(), r.total]));
}
