import type { TransformFnParams } from 'class-transformer';

/**
 * A boolean that arrives as the text 'true' / 'false' (a query string, or a form's Shown/Hidden dropdown).
 *
 * It reads the RAW request value, not the one handed to the transform: the API's global validation turns on implicit type
 * conversion, which converts the text first with Boolean('false'), and that is true. A transform that tests the converted value
 * therefore never sees 'false'. (`?isActive=false` returned active rows until this was found, 2 Nov.)
 */
export const rawBoolean = ({ obj, key }: TransformFnParams) => {
  const raw = obj?.[key];
  return raw === 'true' ? true : raw === 'false' ? false : raw;
};
