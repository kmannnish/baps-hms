// Central error handler.
//
// `pg` puts the SQLSTATE on err.code, so returning err.code straight to the
// client used to surface things like {"error":"22P02"} with a 500 — a stale or
// malformed id in a URL (/bookings/undefined) read as a server fault instead of
// a bad request, and leaked internal detail. Map the SQLSTATEs we can act on to
// real statuses and stable names; anything unrecognised stays a generic 500.
const PG_ERRORS = {
  '22P02': { status: 400, error: 'INVALID_INPUT' },      // malformed uuid/number in a param
  '22003': { status: 400, error: 'VALUE_OUT_OF_RANGE' }, // numeric overflow
  '23502': { status: 400, error: 'MISSING_FIELD' },      // not-null violation
  '23503': { status: 400, error: 'INVALID_REFERENCE' },  // foreign-key violation
  '23505': { status: 409, error: 'DUPLICATE' },          // unique violation
  '23514': { status: 400, error: 'INVALID_VALUE' },      // check-constraint violation
};

function errorHandler(err, req, res, _next) {
  console.error(`[${req.method} ${req.originalUrl}]`, err);

  const mapped = PG_ERRORS[err.code];
  // An error the app threw deliberately (with its own statusCode) wins.
  const status = err.statusCode || mapped?.status || 500;
  const error = err.statusCode ? (err.code || 'REQUEST_FAILED') : mapped?.error || 'INTERNAL_ERROR';

  res.status(status).json({
    error,
    message: process.env.NODE_ENV === 'production'
      ? status >= 500 ? 'An unexpected error occurred.' : 'The request could not be processed.'
      : err.message,
  });
}

module.exports = { errorHandler };
