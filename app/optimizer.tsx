"use client";

/**
 * Tax optimizer dashboard: household inputs on top, the optimizer's
 * recommendations + CFP cost-benefit report below. State lives in memory
 * only — nothing is stored in the browser; the engine runs client-side on
 * every change.
*/
import { useState } from "react";
import { Info } from "lucide-react";
import {
  optimizeHouseholdContributions,
  type HouseholdOptimization,
  type OptimizerMemberInput,
} from "@/lib/engine/optimizer.ts";
import type { ReliefClaim } from "@/lib/engine/tax/reliefs.ts";
import { srsRows, taxRows, taxRulesForYa } from "@/lib/engine/rules-data.ts";
import { formatDollarsWhole as fmt, formatPct, parseDollars } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberReport } from "./report";

/* ------------------------------ Form state ----------------------------- */

type NsmanStatus = "none" | "inactive" | "active" | "key_inactive" | "key_active";

export type MemberForm = {
  age: number;
  sex: "male" | "female";
  citizenship: "sc" | "pr" | "foreigner";
  earnedIncome: number;
  cpfEmployee: number;
  otherIncome: number;
  donations: number;
  /** NSman self relief (male members only; the wife's relief is derived). */
  nsman: NsmanStatus;
  parents: number;
  spouseRelief: boolean;
  familyTopupEligible: boolean;
  currentSrsBalance: number;
  /** Penalty-free withdrawal age, locked at first SRS contribution. */
  srsWithdrawalAge: 62 | 63 | 64;
  expectedSrsReturn: number;
  /** Growth rate of the cash-investing alternative (SRS-vs-cash comparison). */
  expectedEquityReturn: number;
  plannedRetirementAge: number | null; // blank = same as SRS withdrawal age
  /** Part-time work in retirement; attracts earned income relief ($8k at 60+). */
  retirementEarnedIncome: number;
  /** Rental etc. in retirement (no earned income relief). */
  retirementOtherIncome: number;
  /** Blank = withdraw now. */
  earlyWithdrawalAge: number | null;
  /** null = use the optimizer's recommendation. */
  proposedTopUpSelf: number | null;
  proposedTopUpFamily: number | null;
  proposedSrs: number | null;
};

type FormState = {
  ya: number;
  /** Household children (each is a $4,000 QCR pool split between spouses). */
  children: number;
  spouseEnabled: boolean;
  self: MemberForm;
  spouse: MemberForm;
};

function defaultMember(overrides: Partial<MemberForm> = {}): MemberForm {
  return {
    age: 35,
    sex: "male",
    citizenship: "sc",
    earnedIncome: 150_000,
    cpfEmployee: 19_200,
    otherIncome: 0,
    donations: 0,
    nsman: "none",
    parents: 0,
    spouseRelief: false,
    familyTopupEligible: false,
    currentSrsBalance: 0,
    srsWithdrawalAge: 64,
    expectedSrsReturn: 0.07,
    expectedEquityReturn: 0.07,
    plannedRetirementAge: null,
    retirementEarnedIncome: 0,
    retirementOtherIncome: 0,
    earlyWithdrawalAge: null,
    proposedTopUpSelf: null,
    proposedTopUpFamily: null,
    proposedSrs: null,
    ...overrides,
  };
}

const DEFAULT_STATE: FormState = {
  ya: 2026,
  children: 0,
  spouseEnabled: false,
  self: defaultMember(),
  spouse: defaultMember({ sex: "female", earnedIncome: 120_000 }),
};

function toMemberInput(
  f: MemberForm,
  household: {
    /** A male member of the household is an NSman → wife claims NSman Wife Relief. */
    husbandIsNsman: boolean;
    children: number;
    /** The other member's total income; spouse relief requires ≤ the threshold. */
    spouseIncome: number | null;
    spouseReliefThreshold: number;
  },
): OptimizerMemberInput {
  const claims: ReliefClaim[] = [];
  const { husbandIsNsman } = household;
  if (f.sex === "male" && f.nsman !== "none") {
    claims.push({
      type: "nsman_self",
      active: f.nsman === "active" || f.nsman === "key_active",
      keyAppointment: f.nsman === "key_inactive" || f.nsman === "key_active",
    });
  }
  if (f.sex === "female" && husbandIsNsman) {
    claims.push({ type: "nsman_wife" });
  }
  if (f.parents > 0) {
    claims.push({
      type: "parent",
      dependants: Array.from({ length: Math.min(2, f.parents) }, () => ({
        livingTogether: false,
      })),
    });
  }
  if (
    f.spouseRelief &&
    household.spouseIncome != null &&
    household.spouseIncome <= household.spouseReliefThreshold
  ) {
    claims.push({ type: "spouse" });
  }
  // WMCR is linked to the children count: a working mother claims the
  // fixed-dollar scheme for every child (born/adopted on or after 1 Jan 2024).
  const wmcrChildren = f.earnedIncome > 0 ? household.children : 0;
  if (f.sex === "female" && wmcrChildren > 0) {
    claims.push({
      type: "wmcr",
      children: Array.from({ length: wmcrChildren }, (_, i) => ({
        order: i + 1,
        born: "2024-01-01", // fixed-dollar scheme
        qcrClaimed: 4_000,
      })),
    });
  }
  return {
    age: f.age,
    sex: f.sex,
    citizenship: f.citizenship,
    earnedIncome: f.earnedIncome,
    otherIncome: f.otherIncome || undefined,
    donations: f.donations || undefined,
    cpfEmployeeContributions: f.cpfEmployee,
    claims,
    currentSrsBalance: f.currentSrsBalance,
    srsWithdrawalAge: f.srsWithdrawalAge,
    expectedSrsReturn: f.expectedSrsReturn,
    expectedEquityReturn: f.expectedEquityReturn,
    plannedRetirementAge: f.plannedRetirementAge ?? undefined,
    retirementEarnedIncome: f.retirementEarnedIncome || undefined,
    retirementOtherIncome: f.retirementOtherIncome || undefined,
    earlyWithdrawalAge: f.earlyWithdrawalAge ?? undefined,
    familyTopupEligible: f.familyTopupEligible,
    proposedTopUpSelf: f.proposedTopUpSelf ?? undefined,
    proposedTopUpFamily: f.proposedTopUpFamily ?? undefined,
    proposedSrs: f.proposedSrs ?? undefined,
  };
}

/* ------------------------------ Field UI ------------------------------- */

/** Spinner-free numeric input ("textfield" style), comma-tolerant. */
const numInputClass =
  "text-base tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
/** Hoverable ⓘ next to a field label; explains how the field feeds the math. */
function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="cursor-help text-muted-foreground/50 hover:text-muted-foreground"
        aria-label="How this field affects the calculation"
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72 whitespace-normal">{text}</TooltipContent>
    </Tooltip>
  );
}

/** Field label with an optional hint icon. */
function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {hint ? <Hint text={hint} /> : null}
    </div>
  );
}

function Num({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  hint?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel label={label} hint={hint} />
      <Input
        type="text"
        inputMode="decimal"
        className={numInputClass}
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        onChange={(e) => {
          const n = parseDollars(e.target.value);
          if (n !== null) onChange(n);
        }}
      />
    </div>
  );
}

function Pick<T extends string>({
  label,
  value,
  options,
  hint,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  hint?: string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel label={label} hint={hint} />
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full">
          {/* Base-UI SelectValue renders the raw value; show the label. */}
          <SelectValue>{options.find((o) => o.value === value)?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Optional numeric input: blank = null, falls back to a derived default. */
function OptNum({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  hint?: string;
  onChange: (n: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel label={label} hint={hint} />
      <Input
        type="text"
        inputMode="numeric"
        className={numInputClass}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value) || null)
        }
      />
    </div>
  );
}

/** Checkbox rendered as a grid-aligned field cell (label row + control row). */
function Check({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange?: (b: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className="space-y-1.5" title={title}>
      {/* spacer keeps control rows aligned with labelled inputs */}
      <div className="text-xs leading-4 text-transparent select-none">&nbsp;</div>
      <div className="flex h-9 items-center gap-2">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onChange?.(v === true)}
        />
        <span className={`text-sm ${disabled ? "text-muted-foreground" : ""}`}>{label}</span>
      </div>
    </div>
  );
}

/** Percent-rate slider (0–12%, quarter-point steps) as a grid-aligned field. */
export function Rate({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  /** Fraction (0.07 = 7%). */
  value: number;
  hint?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel label={label} hint={hint} />
        <span className="text-xs font-semibold tabular-nums">{formatPct(value)}</span>
      </div>
      <div className="flex h-9 items-center">
        <Slider
          min={0}
          max={0.12}
          step={0.0025}
          value={[value]}
          onValueChange={(v) =>
            onChange(Number((Array.isArray(v) ? v[0]! : v).toFixed(4)))
          }
        />
      </div>
    </div>
  );
}

function MemberFormCard({
  title,
  form,
  onChange,
  husbandIsNsman,
  spouseRelief,
}: {
  title: string;
  form: MemberForm;
  onChange: (patch: Partial<MemberForm>) => void;
  /** Drives the auto-linked (disabled) NSman wife relief checkbox. */
  husbandIsNsman: boolean;
  /** Spouse relief eligibility: the other member's income must not exceed the threshold. */
  spouseRelief: { disabled: boolean; reason?: string };
}) {
  const set = (patch: Partial<MemberForm>) => onChange(patch);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Income, reliefs, and SRS profile</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
          <Num label="Age (at 31 Dec)" value={form.age} onChange={(age) => set({ age })} />
          <Pick
            label="Sex"
            value={form.sex}
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
            ]}
            onChange={(sex) => set({ sex })}
          />
          <Pick
            label="Residency"
            value={form.citizenship}
            options={[
              { value: "sc", label: "Singapore Citizen" },
              { value: "pr", label: "PR" },
              { value: "foreigner", label: "Foreigner" },
            ]}
            onChange={(citizenship) => set({ citizenship })}
          />
          <Num
            label="Annual earned income"
            value={form.earnedIncome}
            onChange={(earnedIncome) => set({ earnedIncome })}
          />
          <Num label="Employee CPF (annual)" value={form.cpfEmployee} onChange={(cpfEmployee) => set({ cpfEmployee })} />
          <Num label="Other income (rental etc.)" value={form.otherIncome} onChange={(otherIncome) => set({ otherIncome })} />
          <Num label="Donations (approved IPC)" value={form.donations} onChange={(donations) => set({ donations })} />
          {form.sex === "male" && (
            <Pick
              label="NSman status"
              value={form.nsman}
              options={[
                { value: "none", label: "None" },
                { value: "inactive", label: "Inactive" },
                { value: "active", label: "Active" },
                { value: "key_inactive", label: "Inactive (KAH)" },
                { value: "key_active", label: "Active (KAH)" },
              ]}
              onChange={(nsman) => set({ nsman })}
            />
          )}
          <Num label="Parent dependants (max 2)" value={form.parents} onChange={(parents) => set({ parents: Math.min(2, Math.max(0, Math.round(parents))) })} />
          {form.sex === "female" && (
            <Check
              label="NSman wife relief ($750, auto)"
              checked={husbandIsNsman}
              disabled
              title="Auto-claimed: the husband is an NSman"
            />
          )}
          <Check
            label="Spouse relief ($2,000)"
            checked={form.spouseRelief && !spouseRelief.disabled}
            disabled={spouseRelief.disabled}
            title={spouseRelief.reason}
            onChange={(spouseRelief) => set({ spouseRelief })}
          />
          <Check
            label="Family CPF top-up ($8k relief)"
            checked={form.familyTopupEligible}
            onChange={(familyTopupEligible) => set({ familyTopupEligible })}
          />
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            SRS &amp; retirement
          </h4>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
            <Num label="Current SRS balance" value={form.currentSrsBalance} onChange={(currentSrsBalance) => set({ currentSrsBalance })} hint="Grows at the SRS growth rate until withdrawal, then pays out over the 10-year window. Tax on this money is unavoidable, so the optimizer only counts tax on new contributions when picking an amount." />
            <Pick
              label="SRS withdrawal age"
              value={String(form.srsWithdrawalAge) as "62" | "63" | "64"}
              options={[
                { value: "62", label: "62" },
                { value: "63", label: "63" },
                { value: "64", label: "64" },
              ]}
              onChange={(v) => set({ srsWithdrawalAge: Number(v) as 62 | 63 | 64 })}
              hint="The age your 10-year penalty-free withdrawal window starts. Withdrawals begin in January of that year. A later age means more years of contributions and a later payout."
            />
            <OptNum label="Planned retirement age" value={form.plannedRetirementAge} placeholder={String(form.srsWithdrawalAge)} onChange={(plannedRetirementAge) => set({ plannedRetirementAge })} hint="Withdrawals start at the later of this and the SRS withdrawal age. Leave blank to match the SRS withdrawal age." />
            {/* Retirement-income scenario fields share their own row. */}
            <div className="sm:col-start-1">
              <Num label="Earned income in retirement (p.a.)" value={form.retirementEarnedIncome} onChange={(retirementEarnedIncome) => set({ retirementEarnedIncome })} hint="Work income during the withdrawal window. It stacks on top of your SRS withdrawals in the tax brackets, so each dollar withdrawn is taxed higher. Gets the earned-income relief ($8k from age 60)." />
            </div>
            <Num label="Rental/other income in retirement (p.a.)" value={form.retirementOtherIncome} onChange={(retirementOtherIncome) => set({ retirementOtherIncome })} hint="Income other than work during the withdrawal window. It stacks on top of your SRS withdrawals in the tax brackets, so each dollar withdrawn is taxed higher. No earned-income relief." />
            <OptNum label="Early withdrawal age (blank = now)" value={form.earlyWithdrawalAge} placeholder={String(form.age)} onChange={(earlyWithdrawalAge) => set({ earlyWithdrawalAge })} hint="What it costs to take the money out before the SRS withdrawal age: a 5% penalty plus tax on the full balance stacked on your income that year, instead of only 50% taxable spread over 10 years." />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------- QCR allocation ---------------------------- */

function QcrAllocationCard({
  result,
  childCount,
  onChildren,
}: {
  result: HouseholdOptimization;
  childCount: number;
  onChildren: (n: number) => void;
}) {
  const names = [result.self.label, result.spouse?.label ?? ""] as const;
  const marginals = [result.self.marginalRate, result.spouse?.marginalRate ?? 0] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Children: where the child relief (QCR) goes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="w-40">
          <Num
            label="Children (QCR $4,000 each)"
            value={childCount}
            onChange={(n) => onChildren(Math.max(0, Math.round(n)))}
          />
        </div>
        {result.allocations.length > 0 ? (
          <div className="space-y-1 text-sm">
            {result.allocations.map((a) => (
              <div key={a.label} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{a.label}</span>
                <span className="tabular-nums font-medium">
                  {a.amounts[1] > 0 && a.amounts[0] > 0
                    ? `${fmt(a.amounts[0])} → ${names[0]} · ${fmt(a.amounts[1])} → ${names[1]}`
                    : `${fmt(a.amounts[0] + a.amounts[1])} → ${a.amounts[0] > 0 ? names[0] : names[1]}`}
                </span>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              {result.spouse
                ? `Split automatically toward the higher marginal bracket: ${names[0]} ${formatPct(marginals[0])} vs ${names[1]} ${formatPct(marginals[1])}.`
                : "Single member: all child relief lands on you."}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Each child is a $4,000 relief pool, split between spouses to minimize the
            household&apos;s tax. A working mother also claims WMCR for every child
            (fixed-dollar scheme, children born on/after 1 Jan 2024).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Page --------------------------------- */

export function Optimizer() {
  // v3: WMCR children linked to the household children count (no input).
  const [state, setState] = useState<FormState>(DEFAULT_STATE);

  const members = [state.self, ...(state.spouseEnabled ? [state.spouse] : [])];
  const husbandIsNsman = members.some((m) => m.sex === "male" && m.nsman !== "none");
  // Spouse relief: claimable only when the spouse's income is ≤ the seeded
  // threshold ($8,000 from YA 2025).
  const spouseReliefThreshold =
    taxRulesForYa(state.ya).rules.reliefs.spouse?.incomeThreshold ?? 8_000;
  const spouseIncomeOf = (member: "self" | "spouse") =>
    !state.spouseEnabled
      ? null
      : member === "self"
        ? state.spouse.earnedIncome + state.spouse.otherIncome
        : state.self.earnedIncome + state.self.otherIncome;
  const spouseReliefFor = (member: "self" | "spouse") => {
    const income = spouseIncomeOf(member);
    if (income == null) {
      return { disabled: true, reason: "Enable the spouse to claim spouse relief" };
    }
    return income > spouseReliefThreshold
      ? {
          disabled: true,
          reason: `Spouse's income ($${income.toLocaleString("en-SG")}) exceeds the $${spouseReliefThreshold.toLocaleString("en-SG")} limit`,
        }
      : { disabled: false };
  };

  // Cheap pure computation (~microseconds); runs per render, no memoization.
  const result = (() => {
    const { rules } = taxRulesForYa(state.ya);
    const incomeYear = state.ya - 1;
    const srsRules =
      srsRows.find((r) => r.year === incomeYear) ?? srsRows[srsRows.length - 1]!;
    const householdOf = (member: "self" | "spouse") => ({
      husbandIsNsman,
      children: state.children,
      spouseIncome: spouseIncomeOf(member),
      spouseReliefThreshold,
    });
    return optimizeHouseholdContributions({
      rules,
      srsRules,
      currentYear: incomeYear,
      self: toMemberInput(state.self, householdOf("self")),
      spouse: state.spouseEnabled
        ? toMemberInput(state.spouse, householdOf("spouse"))
        : undefined,
      sharedReliefPools: Array.from({ length: state.children }, (_, i) => ({
        label: `QCR: child ${i + 1}`,
        amount: 4_000,
      })),
    });
  })();

  const patchSelf = (patch: Partial<MemberForm>) =>
    setState((s) => ({
      ...s,
      self: { ...s.self, ...patch },
      // Spouse defaults to the opposite sex (drives NSman-wife / WMCR fields).
      spouse:
        patch.sex != null
          ? { ...s.spouse, sex: patch.sex === "male" ? "female" : "male" }
          : s.spouse,
    }));
  const patchSpouse = (patch: Partial<MemberForm>) =>
    setState((s) => ({ ...s, spouse: { ...s.spouse, ...patch } }));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kaya: SG Tax Optimizer</h1>
          <p className="text-sm text-muted-foreground">
            CPF MA/SA top-ups + SRS contributions, priced against the tax you&apos;ll
            actually pay on withdrawal.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <Pick
            label="Year of Assessment"
            value={String(state.ya)}
            options={taxRows.map((r) => ({ value: String(r.ya), label: `YA ${r.ya}` }))}
            onChange={(v) => setState((s) => ({ ...s, ya: Number(v) }))}
          />
          <Check
            label="Include spouse"
            checked={state.spouseEnabled}
            onChange={(spouseEnabled) => setState((s) => ({ ...s, spouseEnabled }))}
          />
        </div>
      </header>

      {/* Household summary */}
      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-2 py-4">
          {[
            { label: "Tax before optimization", value: result.combinedBaselineTax, strong: false },
            { label: "Tax after optimization", value: result.combinedOptimizedTax, strong: false },
            { label: `Saved in YA ${state.ya}`, value: result.combinedSavings, strong: true },
          ].map((c) => (
            <div key={c.label} className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <span
                className={`text-xl font-bold tabular-nums ${c.strong ? "text-green-600 dark:text-green-400" : ""}`}
              >
                {fmt(c.value)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <MemberFormCard
          title="You"
          form={state.self}
          onChange={patchSelf}
          husbandIsNsman={husbandIsNsman}
          spouseRelief={spouseReliefFor("self")}
        />
        {state.spouseEnabled && (
          <MemberFormCard
            title="Spouse"
            form={state.spouse}
            onChange={patchSpouse}
            husbandIsNsman={husbandIsNsman}
            spouseRelief={spouseReliefFor("spouse")}
          />
        )}
      </div>

      <QcrAllocationCard
        result={result}
        childCount={state.children}
        onChildren={(n) => setState((s) => ({ ...s, children: n }))}
      />

      <MemberReport plan={result.self} form={state.self} onPropose={patchSelf} ya={state.ya} />
      {result.spouse && (
        <MemberReport plan={result.spouse} form={state.spouse} onPropose={patchSpouse} ya={state.ya} />
      )}

      <footer className="space-y-1 text-xs text-muted-foreground">
        <p>
          Local-only: inputs stay in your browser. Engine figures follow the seeded
          IRAS rule tables; not financial advice.
        </p>
        <p className="flex flex-wrap gap-x-4">
          <span>Sources (IRAS):</span>
          <a className="underline hover:text-foreground" target="_blank" rel="noreferrer"
            href="https://iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/individual-income-tax-rates">
            Income tax rates and brackets
          </a>
          <a className="underline hover:text-foreground" target="_blank" rel="noreferrer"
            href="https://iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions">
            Tax reliefs and the $80k cap
          </a>
          <a className="underline hover:text-foreground" target="_blank" rel="noreferrer"
            href="https://iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-reliefs-rebates-and-deductions/tax-reliefs/central-provident-fund-(cpf)-cash-top-up-relief">
            CPF cash top-up relief
          </a>
          <a className="underline hover:text-foreground" target="_blank" rel="noreferrer"
            href="https://iras.gov.sg/schemes/individual-income-tax/srs-contributions-and-tax-relief">
            SRS contributions and relief
          </a>
          <a className="underline hover:text-foreground" target="_blank" rel="noreferrer"
            href="https://iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/special-tax-schemes/tax-on-srs-withdrawals">
            Tax on SRS withdrawals
          </a>
        </p>
      </footer>
    </main>
  );
}
