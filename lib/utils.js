const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

const getE164 = async(number, country, logger) => {
  const n = phoneUtil.parseAndKeepRawInput(number, country);
  if (!phoneUtil.isValidNumber(n)) {
    logger.warn(`to: ${number} is not a valid phone number in ${country}`);
  }
  return phoneUtil.format(n, PNF.E164); //.replace('+', '') //Strip the +
};


module.exports = { getE164 };
