// AUDIT HELPER — 5-line repro of the String.prototype.replace "$-pattern" bug in ai.service.ts.
const TEMPLATE = 'Current Role: {{currentRole}}\nTarget Role: {{targetRole}}';
for (const role of ['Senior Engineer', 'Senior $& Engineer', "Senior $' Engineer", 'Senior $` Engineer', 'Pay $$5']) {
  console.log(JSON.stringify(role), '=>', JSON.stringify(TEMPLATE.replace('{{currentRole}}', role).replace('{{targetRole}}', 'Staff')));
}
// Fix: use a replacer function so the value is inserted literally: tpl.replace(key, () => value)
console.log('fixed =>', JSON.stringify(TEMPLATE.replace('{{currentRole}}', () => 'Senior $& Engineer')));
