/**
 * Qualifications listed under Step 8 ("Submission of RPL application") of the
 * CPUT undergraduate RPL page:
 *   https://www.cput.ac.za/study-at-cput/undergraduate/rpl
 * Titles are as CPUT lists them.
 *
 * rpl_type
 *   ACCESS            "Access only"
 *   ACCESS_EXEMPTION  "Access and/or exemptions - RPL"
 *   NOT_AVAILABLE     "Not currently available" / "Not available"
 *   UNCONFIRMED       left blank on the page; kept inactive until confirmed
 *
 * nqf_level is filled only where the title names the qualification type
 * (Diploma = NQF 6, Advanced Diploma = NQF 7 under the HEQSF). CPUT does not
 * publish a level for the others, so it is left empty rather than guessed.
 * SAQA IDs are not on the page and are left empty.
 *
 * Only ACCESS and ACCESS_EXEMPTION qualifications are offered to applicants.
 */
const BMS = 'Business and Management Sciences';
const EBE = 'Engineering and the Built Environment';
const ID = 'Informatics and Design';
const HW = 'Health and Wellness';
const EDU = 'Education';

export const CPUT_QUALIFICATIONS = [
  // Faculty of Business and Management Sciences
  { faculty: BMS, title: 'Paralegal Studies',                              rpl_type: 'ACCESS' },
  { faculty: BMS, title: 'Banking',                                        rpl_type: 'ACCESS' },
  { faculty: BMS, title: 'Business and Information Administration (BIA)',  rpl_type: 'ACCESS_EXEMPTION' },
  { faculty: BMS, title: 'Events Management',                              rpl_type: 'ACCESS_EXEMPTION' },
  { faculty: BMS, title: 'Financial Accountancy and Taxation',             rpl_type: 'ACCESS' },
  { faculty: BMS, title: 'Hospitality – Hotel School',                     rpl_type: 'ACCESS_EXEMPTION' },
  { faculty: BMS, title: 'Human Resource Management',                      rpl_type: 'ACCESS_EXEMPTION' },
  { faculty: BMS, title: 'Management and Project Management',              rpl_type: 'ACCESS_EXEMPTION' },
  { faculty: BMS, title: 'Marketing',                                      rpl_type: 'ACCESS_EXEMPTION' },
  { faculty: BMS, title: 'Diploma: Public Administration',                 rpl_type: 'ACCESS_EXEMPTION', nqf_level: 6 },
  { faculty: BMS, title: 'Advanced Diploma: Public Administration',        rpl_type: 'ACCESS_EXEMPTION', nqf_level: 7 },
  { faculty: BMS, title: 'Real Estate',                                    rpl_type: 'NOT_AVAILABLE' },
  { faculty: BMS, title: 'Retail Management',                              rpl_type: 'ACCESS' },
  { faculty: BMS, title: 'Tourism Management',                             rpl_type: 'ACCESS_EXEMPTION' },
  { faculty: BMS, title: 'Operations Management',                          rpl_type: 'ACCESS' },
  { faculty: BMS, title: 'Sport and Leisure Management',                   rpl_type: 'ACCESS' },
  { faculty: BMS, title: 'Entrepreneurship',                               rpl_type: 'ACCESS' },

  // Faculty of Engineering & the Built Environment
  { faculty: EBE, title: 'Diploma in Construction',                        rpl_type: 'NOT_AVAILABLE', nqf_level: 6 },
  { faculty: EBE, title: 'Advanced Diploma in Construction Management',    rpl_type: 'NOT_AVAILABLE', nqf_level: 7 },
  { faculty: EBE, title: 'Advanced Diploma in Facility Management',        rpl_type: 'NOT_AVAILABLE', nqf_level: 7 },
  { faculty: EBE, title: 'Advanced Diploma in Health and Safety',          rpl_type: 'NOT_AVAILABLE', nqf_level: 7 },
  { faculty: EBE, title: 'Advanced Diploma in Quantity Surveying',         rpl_type: 'NOT_AVAILABLE', nqf_level: 7 },
  { faculty: EBE, title: 'Advanced Diploma: Quality',                      rpl_type: 'NOT_AVAILABLE', nqf_level: 7 },

  // Faculty of Informatics and Design
  { faculty: ID,  title: 'Diploma: Architectural Technology',              rpl_type: 'ACCESS_EXEMPTION', nqf_level: 6 },
  { faculty: ID,  title: 'Advanced Diploma: Architectural Design',         rpl_type: 'UNCONFIRMED', nqf_level: 7 },
  { faculty: ID,  title: 'Diploma: Interior Design',                       rpl_type: 'UNCONFIRMED', nqf_level: 6 },
  { faculty: ID,  title: 'Advanced Diploma: Interior Design',              rpl_type: 'UNCONFIRMED', nqf_level: 7 },
  { faculty: ID,  title: 'Information and Communication Technologies (ICT)', rpl_type: 'ACCESS' },

  // Faculty of Health and Wellness
  { faculty: HW,  title: 'Diploma: Emergency Medical Care',                rpl_type: 'ACCESS', nqf_level: 6 },
  { faculty: HW,  title: 'Bachelor: Emergency Medical Care',               rpl_type: 'ACCESS' },
  { faculty: HW,  title: 'Bachelor: Nursing',                              rpl_type: 'NOT_AVAILABLE' },

  // Listed separately: not available due to legislative restrictions
  { faculty: EDU, title: 'Bachelor: Education (Foundation, GET and HET)',  rpl_type: 'NOT_AVAILABLE' },
];

/** The placeholder qualifications from the original prototype seed. They are
 *  deactivated (not deleted) so any existing application still resolves. */
export const LEGACY_DEMO_SAQA_IDS = ['101234', '101235', '101236', '101237', '101238'];

export const OFFERED_RPL_TYPES = ['ACCESS', 'ACCESS_EXEMPTION'];
