import type { ValidationError } from 'class-validator';

/**
 * Turns class-validator output into sentences a person can act on.
 *
 * The defaults read like "parent_location_id must be a UUID" or "property
 * foo should not exist": a database column name where the user expected a field
 * label, and a rule where they expected an instruction. This names the field the
 * way the screen does ("Parent Location") and says what to do about it.
 */

const WORDS: Record<string, string> = {
  id: '',
  ids: '',
  uuid: '',
  uom: 'UOM',
  gl: 'GL',
  rfid: 'RFID',
  grn: 'GRN',
  qc: 'QC',
  qr: 'QR',
  fcr: 'FCR',
  tsi: 'TSI',
  url: 'URL',
  nob: 'Nature of Business',
  lob: 'Line of Business',
  dob: 'Date of Birth',
  kpi: 'KPI',
  bc: 'BC',
  gps: 'GPS',
  pct: '%',
  qty: 'Quantity',
  no: 'No.',
  nos: 'Nos.',
  fifo: 'FIFO',
  sku: 'SKU',
  api: 'API',
};

/** Labels where the mechanical conversion would read badly. */
const LABELS: Record<string, string> = {
  animal_ids: 'Animals',
  input_lines: 'Input Lines',
  output_lines: 'Output Lines',
  lines: 'Lines',
  companyId: 'Company',
  tenantId: 'Tenant',
  email: 'Email',
  password: 'Password',
};

const isIdProperty = (property: string) => /(_id|Id)$/.test(property);
const isIdsProperty = (property: string) => /(_ids|Ids)$/.test(property);

/** `parent_location_id` / `parentLocationId` -> "Parent Location"; `silo_capacity_kg` -> "Silo Capacity Kg". */
export function humanizeFieldName(property: string): string {
  if (LABELS[property]) return LABELS[property];
  const words = property
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const out: string[] = [];
  words.forEach((word, index) => {
    const mapped = WORDS[word];
    if (mapped === '') return; // a trailing "id" is the database's business, not the user's
    if (mapped !== undefined) out.push(mapped);
    else out.push(word.charAt(0).toUpperCase() + word.slice(1));
    void index;
  });
  const label = out.join(' ').replace(/\s+%/g, ' %').trim();
  return label || property;
}

const withArticle = (label: string) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
const firstNumber = (text: string): string | undefined => /-?\d+(?:\.\d+)?/.exec(text)?.[0];

function sentenceFor(property: string, constraint: string, original: string): string {
  const label = humanizeFieldName(property);
  switch (constraint) {
    case 'isNotEmpty':
    case 'isDefined':
      return isIdProperty(property) ? `Select ${withArticle(label)}.` : `${label} is required.`;
    case 'isUuid':
    case 'isUUID':
      return isIdsProperty(property) ? `One of the selected ${label} is not valid. Reload the list and choose again.` : `Select a valid ${label}.`;
    case 'isString':
      return `${label} must be text.`;
    case 'isInt':
      return `${label} must be a whole number.`;
    case 'isNumber':
    case 'isDecimal':
    case 'isNumberString':
      return `${label} must be a number.`;
    case 'isPositive':
      return `${label} must be greater than zero.`;
    case 'isNegative':
      return `${label} must be less than zero.`;
    case 'min':
      return `${label} must be ${firstNumber(original) ?? 'higher'} or more.`;
    case 'max':
      return `${label} must be ${firstNumber(original) ?? 'lower'} or less.`;
    case 'minLength':
      return `${label} needs at least ${firstNumber(original) ?? 'more'} characters.`;
    case 'maxLength':
      return `${label} can have at most ${firstNumber(original) ?? 'fewer'} characters.`;
    case 'length':
      return `${label} must have the right number of characters.`;
    case 'isIn':
    case 'isEnum': {
      const options = /:\s*(.+?)\.?\s*$/.exec(original)?.[1]?.trim();
      return options ? `${label} must be one of: ${options}.` : `${label} is not one of the allowed choices.`;
    }
    case 'isEmail':
      return 'Enter a valid email address.';
    case 'isBoolean':
      return `${label} must be Yes or No.`;
    case 'isDate':
    case 'isDateString':
    case 'isISO8601':
      return `${label} must be a valid date (YYYY-MM-DD).`;
    case 'isArray':
      return `${label} must be a list.`;
    case 'arrayNotEmpty':
      return `${label} needs at least one entry.`;
    case 'arrayMinSize':
      return `${label} needs at least ${firstNumber(original) ?? 'one'} entries.`;
    case 'arrayMaxSize':
      return `${label} can have at most ${firstNumber(original) ?? 'fewer'} entries.`;
    case 'arrayUnique':
      return `${label} has a repeated entry.`;
    case 'isObject':
    case 'isNotEmptyObject':
      return `${label} is not valid.`;
    case 'matches':
      return `${label} is not in the expected format.`;
    case 'isUrl':
      return `${label} must be a valid web address.`;
    case 'whitelistValidation':
      return `${label} is not a field this form accepts.`;
    default:
      // Unknown rule: keep its meaning, but swap the raw property name for the label.
      return original.replace(new RegExp(`\\b${property}\\b`, 'g'), label).replace(/^./, (c) => c.toUpperCase()).replace(/([^.!?])$/, '$1.');
  }
}

function collect(errors: ValidationError[], prefix: string, out: string[]): void {
  for (const error of errors) {
    const isIndex = /^\d+$/.test(error.property);
    const where = isIndex ? `${prefix ? `${prefix} ` : 'Entry '}${Number(error.property) + 1}: ` : prefix ? `${prefix}: ` : '';
    let constraints = Object.entries(error.constraints ?? {});
    // A missing value breaks every type rule too; "is required" is the one worth saying.
    const blank = error.value === undefined || error.value === null || error.value === '';
    if (constraints.some(([name]) => name === 'isNotEmpty' || name === 'isDefined')) {
      constraints = constraints.filter(([name]) => name === 'isNotEmpty' || name === 'isDefined');
    } else if (blank && constraints.length && !constraints.some(([name]) => name === 'whitelistValidation')) {
      constraints = [['isNotEmpty', constraints[0][1]]];
    }
    for (const [constraint, original] of constraints) {
      out.push(`${where}${sentenceFor(error.property, constraint, original)}`);
    }
    if (error.children?.length) {
      const nested = isIndex ? (prefix ? `${prefix} ${Number(error.property) + 1}` : `Entry ${Number(error.property) + 1}`) : humanizeFieldName(error.property);
      collect(error.children, nested, out);
    }
  }
}

/** One readable sentence per problem, in the order the form listed them, without repeats. */
export function formatValidationErrors(errors: ValidationError[]): string[] {
  const out: string[] = [];
  collect(errors, '', out);
  return [...new Set(out)];
}

/**
 * Safety net for hand-written messages: a lowercase_snake_case word is a
 * column or request field, not something to show a person. Swaps each for its
 * label. ALL_CAPS values (NATURAL_MATING) and quoted codes are left alone.
 */
export function humanizeFieldNamesInText(text: string): string {
  return text.replace(/(?<![A-Za-z0-9_'"/.-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![A-Za-z0-9_'"/-])/g, (token) => humanizeFieldName(token));
}
