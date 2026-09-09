/**
 * Version of the media probe rules carried by a probe request.
 *
 * A queued request keeps this value so later policy changes do not silently
 * change the rules applied to an already uploaded object.
 */
export const MEDIA_PROBE_POLICY_VERSION = 'media-v1';

/** Queue discriminator used by the content-owned probe request outbox event. */
export const MEDIA_PROBE_JOB_TYPE = 'MEDIA_PROBE';
