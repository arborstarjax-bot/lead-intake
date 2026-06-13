import "server-only";

/**
 * Lightweight first-name gender detection for voice selection.
 * Returns "male", "female", or "unknown".
 *
 * Uses a curated list of common US first names. If the name isn't in the
 * list, falls back to "unknown" (uses default voice).
 */

const MALE_NAMES = new Set([
  "aaron", "adam", "adrian", "aiden", "alan", "albert", "alex", "alexander",
  "andrew", "angel", "anthony", "antonio", "austin", "barry", "ben",
  "benjamin", "bill", "billy", "blake", "bobby", "brad", "bradley",
  "brandon", "brian", "bruce", "bryan", "caleb", "cameron", "carl",
  "carlos", "chad", "charles", "chase", "chris", "christian", "christopher",
  "clarence", "cody", "cole", "colin", "connor", "corey", "craig", "curtis",
  "dale", "damien", "dan", "daniel", "danny", "darren", "daryl", "dave",
  "david", "dean", "dennis", "derek", "derrick", "devin", "dominic", "don",
  "donald", "doug", "douglas", "drew", "dustin", "dylan", "earl", "eddie",
  "edward", "eli", "elijah", "eric", "erik", "ernest", "ethan", "eugene",
  "evan", "frank", "fred", "frederick", "gabriel", "garrett", "gary",
  "gavin", "george", "gerald", "grant", "greg", "gregory", "harry",
  "hayden", "henry", "howard", "hunter", "ian", "isaac", "ivan", "jack",
  "jackson", "jacob", "jake", "james", "jared", "jason", "jay", "jeff",
  "jeffrey", "jeremy", "jerome", "jerry", "jesse", "jim", "jimmy", "joe",
  "joel", "john", "johnny", "jon", "jonathan", "jordan", "jorge", "jose",
  "joseph", "josh", "joshua", "juan", "julian", "justin", "karl", "keith",
  "ken", "kenneth", "kevin", "kurt", "kyle", "lance", "larry", "lawrence",
  "leo", "leon", "leonard", "liam", "logan", "louis", "lucas", "luis",
  "luke", "marcus", "mario", "mark", "martin", "mason", "matt", "matthew",
  "max", "michael", "miguel", "mike", "mitchell", "nathan", "neil",
  "nicholas", "nick", "noah", "norman", "oliver", "omar", "oscar", "owen",
  "patrick", "paul", "pedro", "peter", "philip", "phillip", "pravin",
  "preston", "randy", "ray", "raymond", "ricardo", "richard", "rick",
  "robert", "roger", "ronald", "ross", "roy", "russell", "ryan", "sam",
  "samuel", "scott", "sean", "seth", "shane", "shawn", "simon", "spencer",
  "stephen", "steve", "steven", "terry", "thomas", "tim", "timothy", "todd",
  "tom", "tommy", "tony", "travis", "trevor", "troy", "tyler", "victor",
  "vincent", "walter", "warren", "wayne", "wesley", "william", "willie",
  "zachary", "zach",
]);

const FEMALE_NAMES = new Set([
  "abigail", "adriana", "alexis", "alice", "alicia", "allison", "amanda",
  "amber", "amy", "andrea", "angela", "angie", "anna", "anne", "annie",
  "april", "ashley", "audrey", "barbara", "becky", "beth", "betty",
  "beverly", "bonnie", "brenda", "bridget", "brittany", "brooke", "caitlin",
  "carly", "carmen", "carol", "caroline", "carolyn", "carrie", "casey",
  "catherine", "cathy", "charlotte", "chelsea", "cheryl", "christina",
  "christine", "cindy", "claire", "claudia", "colleen", "connie",
  "courtney", "crystal", "cynthia", "dana", "danielle", "darlene", "dawn",
  "debbie", "deborah", "denise", "diana", "diane", "donna", "dorothy",
  "eileen", "elaine", "elena", "elizabeth", "ellen", "emily", "emma",
  "erica", "erin", "eva", "evelyn", "faith", "felicia", "fiona", "frances",
  "gabriella", "gail", "gloria", "grace", "gwen", "hailey", "hannah",
  "heather", "helen", "holly", "irene", "jackie", "jacqueline", "jamie",
  "jane", "janet", "janice", "jasmine", "jean", "jeanette", "jennifer",
  "jenny", "jessica", "jill", "joan", "joanne", "jocelyn", "jodie", "joy",
  "joyce", "judy", "julia", "julie", "karen", "kate", "katherine",
  "kathleen", "kathryn", "kathy", "katie", "kayla", "kelly", "kendra",
  "kerry", "kim", "kimberly", "kristen", "kristin", "kristina", "laura",
  "lauren", "leah", "leslie", "lily", "linda", "lindsay", "lisa", "liz",
  "lois", "loretta", "lori", "louise", "lucia", "lynn", "madison",
  "maggie", "mandy", "margaret", "maria", "marie", "marilyn", "marina",
  "marissa", "marlene", "martha", "mary", "maxine", "megan", "melanie",
  "melissa", "michelle", "mildred", "miranda", "molly", "monica", "nancy",
  "natalie", "natasha", "nicole", "nina", "norma", "olivia", "olga",
  "pamela", "patricia", "patty", "paula", "peggy", "penny", "rachel",
  "rebecca", "regina", "renee", "rhonda", "rita", "roberta", "robin",
  "rosa", "rose", "rosemary", "ruby", "ruth", "sabrina", "sally",
  "samantha", "sandra", "sandy", "sara", "sarah", "shannon", "sharon",
  "sheila", "shelley", "shirley", "sophia", "stacy", "stella", "stephanie",
  "susan", "suzanne", "sylvia", "tammy", "tanya", "tara", "teresa",
  "theresa", "tiffany", "tina", "tracy", "valerie", "vanessa", "veronica",
  "vicki", "victoria", "virginia", "vivian", "wendy", "whitney", "yvonne",
]);

export type GenderGuess = "male" | "female" | "unknown";

export function guessGender(firstName: string | null | undefined): GenderGuess {
  if (!firstName) return "unknown";
  const normalized = firstName.trim().toLowerCase().split(/\s+/)[0]; // First word only
  if (MALE_NAMES.has(normalized)) return "male";
  if (FEMALE_NAMES.has(normalized)) return "female";
  return "unknown";
}

/**
 * Select voice for a lead.
 * Currently uses Elliot (male) for all calls — non-default voices
 * (Savannah, Clara, Tara) fail with pipeline-error when passed as overrides.
 */
export function selectVoiceForLead(
  firstName: string | null | undefined,
  config?: {
    agent_name: string;
    agent_name_male?: string | null;
    agent_name_female?: string | null;
  }
): {
  provider: string;
  voiceId: string;
  agentName: string;
} {
  // Use male voice (Elliot) for all calls — voice overrides cause pipeline errors
  const maleName = config?.agent_name_male || config?.agent_name || "David";
  return { provider: "vapi", voiceId: "Elliot", agentName: maleName };
}
