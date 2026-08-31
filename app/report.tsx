"use client";

/**
 * Per-member CFP cost-benefit report: relief breakdown, immediate tax alpha,
 * the at-retirement 10-year drawdown, the early-withdrawal scenario, the
 * SRS-vs-cash comparison, and the net lifetime verdict. Proposed amounts
 * default to the optimizer's recommendation and can be overridden to
 * what-if. With no SRS proposal the report still renders, priced at the
 * recommendation (else the cap), so the cost of contributing stays visible.
 */
import type { MemberPlan } from "@/lib/engine/optimizer.ts";
import type { BracketTaxLine } from "@/lib/engine/tax/index.ts";
import type { ReactNode } from "react";
import { useState } from "react";
import { formatDollarsWhole as fmt, formatPct } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Rate, type MemberForm } from "./optimizer";

const VERDICT_CLASS: Record<MemberPlan["verdict"], string> = {
  yes: "bg-green-600 text-white dark:bg-green-700",
  conditional: "bg-amber-500 text-white dark:bg-amber-600",
  no: "bg-zinc-500 text-white dark:bg-zinc-600",
};
const VERDICT_LABEL: Record<MemberPlan["verdict"], string> = {
  yes: "SRS: Worth it",
  conditional: "SRS: Conditional",
  no: "SRS: Not worth it",
};

/** Human labels for relief types in the engine's breakdown rows. */
const RELIEF_LABELS: Record<string, string> = {
  earned_income: "Earned income",
  cpf_employee: "CPF (employee)",
  cpf_cash_topup: "CPF cash top-up (MA/SA)",
  srs: "SRS",
  qcr: "Child relief (QCR)",
  wmcr: "Working mother's child relief",
  parent: "Parent",
  spouse: "Spouse",
  nsman_self: "NSman (self)",
  nsman_wife: "NSman (wife)",
  nsman_parent: "NSman (parent)",
  grandparent_caregiver: "Grandparent caregiver",
  sibling_disability: "Sibling (disability)",
  course_fees: "Course fees",
  life_insurance: "Life insurance",
};

const cellR = "text-right tabular-nums";

function Lever({
  label,
  recommended,
  proposed,
  max,
  onChange,
}: {
  label: string;
  recommended: number;
  /** null = following the recommendation. */
  proposed: number | null;
  max: number;
  onChange: (n: number | null) => void;
}) {
  const value = proposed ?? recommended;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {proposed != null && (
            <Button variant="link" size="xs" onClick={() => onChange(null)}>
              reset
            </Button>
          )}
        </div>
        <div className="mt-1 text-xl font-bold tabular-nums">{fmt(value)}</div>
        <Slider
          className="mt-3"
          min={0}
          max={max}
          step={100}
          value={[value]}
          onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        />
        <div className="mt-1.5 text-xs text-muted-foreground">
          recommended {fmt(recommended)} · cap {fmt(max)}
        </div>
      </CardContent>
    </Card>
  );
}

/** Chevron toggle for a row's breakdown lines. */
function Toggle({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="cursor-pointer" onClick={onToggle}>
      <span className="mr-1 inline-block w-3 text-muted-foreground">
        {open ? "▾" : "▸"}
      </span>
      {children}
    </button>
  );
}

/** Muted indented sub-row (a breakdown line of the row above). */
function SubRow({
  label,
  before,
  after,
}: {
  label: string;
  before: ReactNode;
  after: ReactNode;
}) {
  return (
    <TableRow>
      <TableCell className="pl-7 text-muted-foreground">{label}</TableCell>
      <TableCell className={`${cellR} text-muted-foreground`}>{before}</TableCell>
      <TableCell className={`${cellR} text-muted-foreground`}>{after}</TableCell>
    </TableRow>
  );
}

/** IRAS-table style tier label: "first $20,000 @ 0%", "next $10,000 @ 2%". */
function tierLabel(line: BracketTaxLine, first: boolean): string {
  const rate = formatPct(line.rate);
  if (line.upTo === null) return `over ${fmt(line.from)} @ ${rate}`;
  return `${first ? "first" : "next"} ${fmt(line.upTo - line.from)} @ ${rate}`;
}

/** Tier tax, with the taxed portion shown when the tier isn't full. */
function tierTax(line: BracketTaxLine | undefined): ReactNode {
  if (!line) return fmt(0);
  const full = line.upTo === null || line.taxedAmount === line.upTo - line.from;
  return full ? fmt(line.tax) : `${fmt(line.tax)} (on ${fmt(line.taxedAmount)})`;
}

export function MemberReport({
  plan,
  form,
  onPropose,
  ya,
}: {
  plan: MemberPlan;
  form: MemberForm;
  onPropose: (patch: Partial<MemberForm>) => void;
  ya: number;
}) {
  const { baseline, optimized, savings, srs } = plan;
  const srsCap = form.citizenship === "foreigner" ? 35_700 : 15_300;
  const [showReliefs, setShowReliefs] = useState(true);
  const [showTiers, setShowTiers] = useState(true);

  const beforeReliefs: Record<string, number> = {};
  for (const r of baseline.reliefs) beforeReliefs[r.type] = r.amount;
  const afterReliefs: Record<string, number> = {};
  for (const r of optimized.reliefs) afterReliefs[r.type] = r.amount;
  const reliefTypes = [...new Set([...baseline.reliefs, ...optimized.reliefs].map((r) => r.type))];
  const reliefCapBinds =
    baseline.totalReliefsBeforeCap > baseline.totalReliefs ||
    optimized.totalReliefsBeforeCap > optimized.totalReliefs;

  // Same bracket table both columns, so lines align by index.
  const tiers =
    baseline.bracketBreakdown.length >= optimized.bracketBreakdown.length
      ? baseline.bracketBreakdown
      : optimized.bracketBreakdown;
  const hasRebate = baseline.rebate > 0 || optimized.rebate > 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
        <CardTitle className="text-lg">{plan.name}</CardTitle>
        <Badge className={VERDICT_CLASS[plan.verdict]}>{VERDICT_LABEL[plan.verdict]}</Badge>
        <a
          className="text-sm text-muted-foreground underline decoration-dotted hover:text-foreground"
          target="_blank"
          rel="noreferrer"
          href="https://iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/individual-income-tax-rates"
          title="IRAS: individual income tax rates"
        >
          marginal bracket {formatPct(plan.marginalRate)}
        </a>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Levers */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Lever
            label="CPF top-up: own SA/MA"
            recommended={plan.recommended.topUpSelf}
            proposed={form.proposedTopUpSelf}
            max={8_000}
            onChange={(n) => onPropose({ proposedTopUpSelf: n })}
          />
          <Lever
            label="CPF top-up: family"
            recommended={plan.recommended.topUpFamily}
            proposed={form.proposedTopUpFamily}
            max={8_000}
            onChange={(n) => onPropose({ proposedTopUpFamily: n })}
          />
          <Lever
            label="SRS contribution (per year)"
            recommended={plan.recommended.srsAnnual}
            proposed={form.proposedSrs}
            max={srsCap}
            onChange={(n) => onPropose({ proposedSrs: n })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          How the SRS amount is picked: each contributed dollar saves your marginal bracket
          now, but grows your SRS balance, and withdrawals are 50% taxable over the
          10-year window after age {srs.withdrawalAge}. The recommendation maximizes the
          SRS advantage over investing the same dollars with cash: savings compounded at
          the equity rate, minus the growth handicap and the withdrawal tax (section 4).
          Top-ups have no future tax, so they fill every taxable dollar up to the $8k caps.
        </p>

        {/* 1. Immediate tax alpha */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">1 · Immediate tax alpha (YA {ya})</h3>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>Assessable income</TableCell>
                <TableCell className={cellR}>{fmt(baseline.assessableIncome)}</TableCell>
                <TableCell className={cellR}>{fmt(optimized.assessableIncome)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Toggle open={showReliefs} onToggle={() => setShowReliefs((v) => !v)}>Total reliefs (cap $80,000)</Toggle></TableCell>
                <TableCell className={cellR}>{fmt(baseline.totalReliefs)}</TableCell>
                <TableCell className={cellR}>{fmt(optimized.totalReliefs)}</TableCell>
              </TableRow>
              {showReliefs && reliefTypes.map((t) => (
                <SubRow
                  key={t}
                  label={RELIEF_LABELS[t] ?? t}
                  before={fmt(beforeReliefs[t] ?? 0)}
                  after={fmt(afterReliefs[t] ?? 0)}
                />
              ))}
              {reliefCapBinds && showReliefs && (
                <SubRow
                  label="cap applies — reliefs before the cap"
                  before={fmt(baseline.totalReliefsBeforeCap)}
                  after={fmt(optimized.totalReliefsBeforeCap)}
                />
              )}
              <TableRow>
                <TableCell>Chargeable income</TableCell>
                <TableCell className={cellR}>{fmt(baseline.chargeableIncome)}</TableCell>
                <TableCell className={cellR}>{fmt(optimized.chargeableIncome)}</TableCell>
              </TableRow>
              <TableRow className="font-semibold">
                <TableCell><Toggle open={showTiers} onToggle={() => setShowTiers((v) => !v)}>Tax payable</Toggle></TableCell>
                <TableCell className={cellR}>{fmt(baseline.taxPayable)}</TableCell>
                <TableCell className={cellR}>{fmt(optimized.taxPayable)}</TableCell>
              </TableRow>
              {showTiers && tiers.map((line, i) => (
                <SubRow
                  key={line.upTo ?? "top"}
                  label={tierLabel(line, i === 0)}
                  before={tierTax(baseline.bracketBreakdown[i])}
                  after={tierTax(optimized.bracketBreakdown[i])}
                />
              ))}
              {hasRebate && showTiers && (
                <SubRow
                  label={`less YA ${ya} rebate`}
                  before={baseline.rebate > 0 ? `−${fmt(baseline.rebate)}` : "—"}
                  after={optimized.rebate > 0 ? `−${fmt(optimized.rebate)}` : "—"}
                />
              )}
            </TableBody>
          </Table>
          <p className="mt-2 text-sm">
            Saved <strong>{fmt(savings.total)}</strong> this year: {fmt(savings.topUp)} from
            CPF top-ups, {fmt(savings.srs)} from SRS
            {plan.proposed.srsAnnual > 0 && (
              <>
                {" "}
                (<strong>{formatPct(srs.effectiveReturnPct)}</strong> immediate return on SRS
                dollars)
              </>
            )}
            .
          </p>
        </section>

        {plan.proposed.srsAnnual === 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            No SRS contribution proposed — sections 2–5 show what contributing{" "}
            {fmt(srs.annualContribution)}/yr would do.
          </p>
        )}

        {/* 2. Retirement withdrawal */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">
            2 · At retirement ({srs.withdrawalAge}), the 10-year drawdown
          </h3>
          <p className="mb-2 text-sm text-muted-foreground">
            Contributing {fmt(srs.annualContribution)}/yr for {srs.yearsContributing} years
            (total {fmt(srs.totalContributions)}) grows to{" "}
            <strong className="text-foreground">{fmt(srs.projectedBalance)}</strong> at
            withdrawal age. Withdrawals are 50% taxable, spread to fill the lowest brackets
            {(form.retirementEarnedIncome > 0 || form.retirementOtherIncome > 0) &&
              ", net of the earned income relief ($8,000 at 60+) on any part-time income"}
            .
            {srs.atRetirement.schedule.residual &&
              " The balance compounds during the window, so the plan is recomputed each year; whatever remains at the end is deemed withdrawn and taxed at 50%."}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className={cellR}>Withdrawal</TableHead>
                <TableHead className={cellR}>Taxable (50%)</TableHead>
                <TableHead className={cellR}>Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {srs.atRetirement.schedule.years.map((y) => (
                <TableRow key={y.year}>
                  <TableCell>{y.year}</TableCell>
                  <TableCell className={cellR}>{fmt(y.withdrawal)}</TableCell>
                  <TableCell className={cellR}>{fmt(y.taxableAmount)}</TableCell>
                  <TableCell className={cellR}>{fmt(y.tax)}</TableCell>
                </TableRow>
              ))}
              {srs.atRetirement.schedule.residual && (
                <TableRow>
                  <TableCell>
                    {srs.atRetirement.schedule.residual.year} — balance left (deemed
                    withdrawn)
                  </TableCell>
                  <TableCell className={cellR}>
                    {fmt(srs.atRetirement.schedule.residual.amount)}
                  </TableCell>
                  <TableCell className={cellR}>
                    {fmt(srs.atRetirement.schedule.residual.taxableAmount)}
                  </TableCell>
                  <TableCell className={cellR}>
                    {fmt(srs.atRetirement.schedule.residual.tax)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className={cellR}>
                  {fmt(
                    srs.atRetirement.schedule.totalWithdrawn +
                      (srs.atRetirement.schedule.residual?.amount ?? 0),
                  )}
                </TableCell>
                <TableCell className={cellR}></TableCell>
                <TableCell className={cellR}>{fmt(srs.atRetirement.totalTax)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <p className="mt-2 text-sm">
            Effective tax on withdrawals:{" "}
            <strong>{formatPct(srs.atRetirement.effectiveRate)}</strong>
          </p>
        </section>

        {/* 3. Early withdrawal */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">
            3 · Early withdrawal (age {srs.early.age}), worst case
          </h3>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>Balance withdrawn</TableCell>
                <TableCell className={cellR}>{fmt(srs.early.balance)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>5% penalty</TableCell>
                <TableCell className={cellR}>{fmt(srs.early.penalty)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Tax (100% taxable, stacked on income)</TableCell>
                <TableCell className={cellR}>{fmt(srs.early.tax)}</TableCell>
              </TableRow>
              <TableRow className="font-semibold">
                <TableCell>Total cost</TableCell>
                <TableCell className={cellR}>
                  {fmt(srs.early.totalCost)} ({formatPct(srs.early.effectiveRate)})
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>

        {/* 4. SRS vs investing with cash */}
        {srs.vsCash && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              4 · SRS vs investing with cash
            </h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Same {fmt(srs.annualContribution)}/yr, two paths to age {srs.withdrawalAge}.
              SRS grows with withdrawals taxed on the way out; cash grows with no relief
              now and no tax on gains (Singapore has no capital gains tax). The annual tax
              savings are reinvested at the equity rate.
            </p>
            <div className="mb-3 grid max-w-md grid-cols-2 gap-x-6">
              <Rate
                label="SRS growth rate"
                value={form.expectedSrsReturn}
                onChange={(expectedSrsReturn) => onPropose({ expectedSrsReturn })}
              />
              <Rate
                label="Equity growth rate"
                value={form.expectedEquityReturn}
                onChange={(expectedEquityReturn) =>
                  onPropose({ expectedEquityReturn })
                }
              />
            </div>
            <Table>
              <TableBody>
                <TableRow className="font-semibold">
                  <TableCell>SRS path</TableCell>
                  <TableCell className={cellR}>{fmt(srs.vsCash.srsTotal)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-7 text-muted-foreground">
                    Contributions grown at {formatPct(form.expectedSrsReturn)}
                  </TableCell>
                  <TableCell className={`${cellR} text-muted-foreground`}>
                    {fmt(srs.vsCash.contributionsAtRetirement)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-7 text-muted-foreground">
                    − Withdrawal tax on the new money
                  </TableCell>
                  <TableCell className={`${cellR} text-muted-foreground`}>
                    −{fmt(srs.vsCash.withdrawalTax)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-7 text-muted-foreground">
                    + Tax savings reinvested at {formatPct(form.expectedEquityReturn)}
                  </TableCell>
                  <TableCell className={`${cellR} text-muted-foreground`}>
                    {fmt(srs.vsCash.savingsAtRetirement)}
                  </TableCell>
                </TableRow>
                <TableRow className="font-semibold">
                  <TableCell>
                    Cash path (invested at {formatPct(form.expectedEquityReturn)})
                  </TableCell>
                  <TableCell className={cellR}>{fmt(srs.vsCash.cashTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="mt-2 text-sm">
              {srs.vsCash.advantage >= 0 ? (
                <>
                  SRS wins by{" "}
                  <strong className="text-green-600 dark:text-green-400">
                    {fmt(srs.vsCash.advantage)}
                  </strong>{" "}
                  at retirement.
                </>
              ) : (
                <>
                  Cash investing wins by{" "}
                  <strong className="text-red-600 dark:text-red-400">
                    {fmt(-srs.vsCash.advantage)}
                  </strong>{" "}
                  at retirement — and stays liquid throughout.
                </>
              )}
            </p>
          </section>
        )}

        {/* 5. Verdict */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">5 · Net lifetime benefit</h3>
          <p className="text-sm">
            {srs.vsCash ? (
              <>
                Tax saved {fmt(srs.lifetimeSavings)} + reinvestment growth{" "}
                {fmt(srs.vsCash.savingsAtRetirement - srs.lifetimeSavings)} (at{" "}
                {formatPct(form.expectedEquityReturn)}) − retirement tax{" "}
                {fmt(srs.atRetirement.totalTax)} ={" "}
              </>
            ) : (
              <>
                Lifetime savings {fmt(srs.lifetimeSavings)} (assuming constant income) −
                retirement tax {fmt(srs.atRetirement.totalTax)} ={" "}
              </>
            )}
            <strong
              className={
                srs.netLifetimeBenefit >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }
            >
              {fmt(srs.netLifetimeBenefit)}
            </strong>
          </p>
          {srs.vsCash && srs.vsCash.advantage !== srs.netLifetimeBenefit && (
            <p className="mt-1 text-sm">
              Against investing the same dollars with cash at{" "}
              {formatPct(form.expectedEquityReturn)}:{" "}
              {srs.vsCash.advantage >= 0 ? (
                <>
                  SRS wins by{" "}
                  <strong className="text-green-600 dark:text-green-400">
                    {fmt(srs.vsCash.advantage)}
                  </strong>
                </>
              ) : (
                <>
                  SRS loses by{" "}
                  <strong className="text-red-600 dark:text-red-400">
                    {fmt(-srs.vsCash.advantage)}
                  </strong>
                </>
              )}{" "}
              at age {srs.withdrawalAge}. The gap versus the tax arbitrage above is the
              two paths&apos; growth difference
              {form.currentSrsBalance > 0 &&
                ", plus the sunk withdrawal tax on your existing balance"}
              .
            </p>
          )}
        </section>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {plan.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
