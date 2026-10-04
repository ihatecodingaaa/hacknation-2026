import { normalizeSpeech } from "./speech";
import type { SignalId } from "./types";

// Quote support: do the expert's own words say what the claim says?
//
// A model may map "The video started right after the deployment" (a Scribe
// mishearing) onto "failure began right after a deploy". The quote is really
// in the transcript, and the telemetry really shows a failure after a deploy,
// but the words do not say that. This gate checks the words alone, with fixed
// concept anchors per signal. It never looks at telemetry: what the expert
// said and what the world shows are separate checks, and both must pass.

type Span = { start: number; end: number };

// Clause breaks: punctuation, and conjunctions that join separate statements.
// "because of" and "due to" are causal links inside one statement, not breaks.
const BREAK = /[.,;!?]|\b(?:and|but|while|although|whereas|because(?!\s+of))\b/gi;

/**
 * The quote together with the rest of its clause, in the expert's original
 * words: "right after the deployment" is read with "The failures started"
 * before it, never with a neighbouring clause.
 */
export function clauseAround(text: string, span: Span): string {
  let from = 0;
  let to = text.length;
  BREAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BREAK.exec(text))) {
    const bStart = m.index;
    const bEnd = m.index + m[0].length;
    if (bEnd <= span.start) from = Math.max(from, bEnd);
    else if (bStart >= span.end) {
      to = bStart;
      break;
    }
  }
  return text.slice(from, to);
}

const w = (source: string) => new RegExp(String.raw`\b(?:${source})\b`, "i");

// Concept anchors. Deliberately small and specific to this incident vocabulary.
const DEPLOY = w(String.raw`deploy\w*|releas\w*|roll(?:ed|ing)?[\s-]?outs?|rollouts?|ship(?:ped|ping)?|push(?:ed|ing)?|upgrade[ds]?|versions?|new (?:build|code)|v\d[\w.]*`);
const FAILURE = w(
  String.raw`fail\w*|errors?|erroring|5xx|500s?|50\d|exceptions?|broke|broken|break(?:s|ing)?|crash\w*|degrad\w*|incidents?|outages?|problems?|issues?|accident|regress\w*|down|timeouts?|timing out|latency|slow\w*`,
);
// "started" alone is not a failure; it only links one when a failure word is there too.
const LINK = w(
  String.raw`after|since|following|when|once|as soon as|caus\w*|because of|due to|broke|introduc\w*|trigger\w*|lin(?:e|ed|es) up|coincid\w*|correlat\w*|start\w*|began|begin\w*|kicked off`,
);
const BEFORE = w(String.raw`before|prior to|ahead of`);
const NEGATION = w(String.raw`not|no|never|none|nothing|neither|nor|without|cannot|\w+n't`);
const NORMAL = w(String.raw`normal|fine|flat|ok|okay|low|clean|healthy|stable|good|unchanged|steady|unaffected`);

const ERRORS = w(String.raw`errors?|error rate|erroring|5xx|500s?|50\d|failures?|failing|fail(?:s|ed)?|exceptions?`);
const LATENCY = w(String.raw`latency|p9\d|response times?|slow\w*|lag\w*|timeouts?|timing out`);
const ABNORMAL = w(String.raw`up|high|higher|elevated|spik\w*|increas\w*|rose|rising|jump\w*|climb\w*|worse|bad|through the roof|degrad\w*|slow\w*|lag\w*|timeouts?|timing out`);
const CPU = w(String.raw`cpu|load|capacity|cores?`);
const SATURATED = w(String.raw`saturat\w*|high|maxed(?: out)?|max(?:ed)? out|pegged|spik\w*|100\s?%|through the roof|hot|overloaded`);
const DB = w(String.raw`database|db|postgres\w*|mysql|sql|primary|replica`);
const DEGRADED = w(String.raw`down|degraded|slow\w*|fail\w*|struggl\w*|overload\w*|locked|lagging|unhealthy|timing out|timeouts?|errors?|broken`);

// Version scope: isolation to the new version, or the old one being healthy.
const NEWISH = String.raw`(?:new|newer|newest|latest|canary|updated|v\d[\w.]*)`;
const ISOLATED_NEW = new RegExp(
  String.raw`\b(?:only|isolated to|limited to|confined to|specific to)\s+(?:(?:on|in|affects?|hitting|the|to)\s+){0,3}${NEWISH}\b|\bjust\s+the\s+${NEWISH}\s+(?:version|build|release|pods?|instances?|nodes?|code)\b|\b${NEWISH}\s+(?:version|build|release|pods?|instances?)\s+(?:only|alone)\b`,
  "i",
);
const OLD_HEALTHY = new RegExp(
  String.raw`\b(?:old|older|previous|stable|prior|other)\s+(?:version|build|release|pods?|instances?|nodes?|replicas?)\s+(?:is|was|are|were|stayed|stays|remain(?:s|ed)?|look(?:s|ed)?|seem(?:s|ed)?)\s+(?:still\s+)?(?:fine|healthy|ok|okay|clean|good|normal|unaffected)\b`,
  "i",
);
const NOT_ONLY_NEW = new RegExp(String.raw`\bnot\s+(?:just|only)\s+(?:on\s+|in\s+)?(?:the\s+)?${NEWISH}\b`, "i");
const GLOBAL_SCOPE = new RegExp(
  String.raw`\b(?:all|every|both|each)\s+(?:(?:the|of the|of)\s+)?(?:versions?|releases?|builds?|pods?|instances?|replicas?|nodes?)\b|\bold and new\b|\bnew and old\b|\b(?:old|previous|stable)\s+(?:version|build|release|pods?)\s+(?:is|was|are|were)\s+also\b`,
  "i",
);
const AFFECTED = w(String.raw`fail\w*|affected|error\w*|broken|down|degraded|bad`);

export type Support = { supported: true } | { supported: false; reason: string };

const yes: Support = { supported: true };
const no = (reason: string): Support => ({ supported: false, reason });

/**
 * Do these words, on their own, support the claim? `text` is the expert's
 * words (normally clauseAround() of a traced quote). Deterministic, and it can
 * only refuse claims, never create them.
 */
export function quoteSupportsSignal(signal: SignalId, claimed: "present" | "absent", text: string): Support {
  const t = normalizeSpeech(text).text.toLowerCase();
  const negated = NEGATION.test(t);
  const normal = NORMAL.test(t);

  switch (signal) {
    case "deploy_preceded_failure":
      if (!DEPLOY.test(t)) return no("The words do not mention a deploy or release");
      if (claimed === "absent") {
        return negated || BEFORE.test(t) ? yes : no("The words do not say there was no deploy, or that it came later");
      }
      if (!FAILURE.test(t)) return no("The words say something happened around a deploy, not that anything failed");
      if (!LINK.test(t)) return no("The words do not tie the failure to the deploy in time or cause");
      if (negated || BEFORE.test(t)) return no("The words negate the link, or put the failure before the deploy");
      return yes;

    case "error_spike":
      if (!ERRORS.test(t)) return no("The words do not mention errors or failures");
      if (claimed === "absent") return negated || normal ? yes : no("The words do not say errors were normal");
      return negated || normal ? no("The words describe errors as normal or absent") : yes;

    case "latency_up":
      if (!LATENCY.test(t)) return no("The words do not mention latency or response times");
      if (claimed === "absent") return negated || normal ? yes : no("The words do not say latency was normal");
      if (negated || normal) return no("The words describe latency as normal");
      return ABNORMAL.test(t) ? yes : no("The words mention latency without saying it was abnormal");

    case "new_version_only":
      if (claimed === "absent") {
        return NOT_ONLY_NEW.test(t) ? yes : no("The words do not say the failures went beyond the new version");
      }
      if (OLD_HEALTHY.test(t)) return negated ? no("The words negate the old version being healthy") : yes;
      if (!ISOLATED_NEW.test(t)) return no("The words mention a version without saying the problem is isolated to it");
      return negated || normal ? no("The words negate the isolation or call the new version healthy") : yes;

    case "all_versions_affected":
      if (!GLOBAL_SCOPE.test(t)) return no("The words do not refer to all versions");
      if (claimed === "absent") return negated || normal ? yes : no("The words do not say the other versions were fine");
      if (!AFFECTED.test(t)) return no("The words refer to all versions without saying they were failing");
      return negated || normal ? no("The words describe the versions as fine") : yes;

    case "cpu_saturated":
      if (!CPU.test(t)) return no("The words do not mention CPU or load");
      if (claimed === "absent") return negated || normal ? yes : no("The words do not say CPU was normal");
      if (negated || normal) return no("The words describe CPU as normal");
      return SATURATED.test(t) ? yes : no("The words mention CPU without saying it was saturated");

    case "db_degraded":
      if (!DB.test(t)) return no("The words do not mention the database");
      if (claimed === "absent") return negated || normal ? yes : no("The words do not say the database was healthy");
      if (negated || normal) return no("The words describe the database as healthy");
      return DEGRADED.test(t) ? yes : no("The words mention the database without saying it was degraded");
  }
}
