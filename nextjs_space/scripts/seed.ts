import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Seed test user
  const hashedPassword = await bcrypt.hash('johndoe123', 10);
  await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      name: 'John Doe',
      password: hashedPassword,
      role: 'admin',
    },
  });
  console.log('  ✓ Test user');

  // 2. Seed system status
  const existingStatus = await prisma.systemStatus.findFirst();
  if (!existingStatus) {
    await prisma.systemStatus.create({
      data: {
        gmailWatchActive: true,
        watchExpiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastWatchRenewal: new Date(),
        pollingEnabled: false,
        webhookEnabled: true,
      },
    });
  }
  console.log('  ✓ System status');

  // 3. Seed app config (fonts)
  const fontConfigs = [
    { key: 'font_english', value: 'Playzone', label: 'English Font', category: 'fonts' },
    { key: 'font_hebrew', value: 'פיל כחול', label: 'Hebrew Font', category: 'fonts' },
  ];
  for (const fc of fontConfigs) {
    await prisma.appConfig.upsert({
      where: { key: fc.key },
      update: { value: fc.value },
      create: fc,
    });
  }
  console.log('  ✓ App config (fonts)');

  // 4. Seed knowledge base from family_data.json
  const familyDataPath = '/home/ubuntu/shared/family_data.json';
  if (!fs.existsSync(familyDataPath)) {
    console.log('  ⚠ family_data.json not found, skipping knowledge seed');
    console.log('Seeding complete!');
    return;
  }

  const familyData = JSON.parse(fs.readFileSync(familyDataPath, 'utf-8'));
  const entries: Array<{
    category: string;
    key: string;
    value: string;
    language: string;
    appliesToPerson: string | null;
  }> = [];

  // Family-wide entries
  entries.push({ category: 'personal', key: 'Family Name (EN)', value: familyData.family_name.english, language: 'en', appliesToPerson: null });
  entries.push({ category: 'personal', key: 'Family Name (HE)', value: familyData.family_name.hebrew, language: 'he', appliesToPerson: null });
  entries.push({ category: 'address', key: 'Full Address (EN)', value: familyData.address.english, language: 'en', appliesToPerson: null });
  entries.push({ category: 'address', key: 'Full Address (HE)', value: familyData.address.hebrew, language: 'he', appliesToPerson: null });
  entries.push({ category: 'address', key: 'Street (EN)', value: familyData.address.street_english, language: 'en', appliesToPerson: null });
  entries.push({ category: 'address', key: 'Street (HE)', value: familyData.address.street_hebrew, language: 'he', appliesToPerson: null });
  entries.push({ category: 'address', key: 'City (EN)', value: familyData.address.city_english, language: 'en', appliesToPerson: null });
  entries.push({ category: 'address', key: 'City (HE)', value: familyData.address.city_hebrew, language: 'he', appliesToPerson: null });
  entries.push({ category: 'address', key: 'ZIP Code', value: familyData.address.zip, language: 'both', appliesToPerson: null });
  entries.push({ category: 'address', key: 'Country (EN)', value: familyData.address.country_english, language: 'en', appliesToPerson: null });
  entries.push({ category: 'address', key: 'Country (HE)', value: familyData.address.country_hebrew, language: 'he', appliesToPerson: null });
  entries.push({ category: 'medical', key: 'HMO', value: 'Maccabi', language: 'both', appliesToPerson: null });
  entries.push({ category: 'medical', key: 'קופת חולים', value: 'מכבי', language: 'he', appliesToPerson: null });
  entries.push({ category: 'preference', key: 'Date Format', value: familyData.date_format || 'DD-MM-YYYY', language: 'both', appliesToPerson: null });

  // Father
  const f = familyData.father;
  entries.push({ category: 'personal', key: 'First Name (EN)', value: f.first_name_english, language: 'en', appliesToPerson: f.first_name_english });
  entries.push({ category: 'personal', key: 'First Name (HE)', value: f.first_name_hebrew, language: 'he', appliesToPerson: f.first_name_english });
  entries.push({ category: 'personal', key: 'Full Name (EN)', value: f.full_name_english, language: 'en', appliesToPerson: f.first_name_english });
  entries.push({ category: 'personal', key: 'Full Name (HE)', value: f.full_name_hebrew, language: 'he', appliesToPerson: f.first_name_english });
  entries.push({ category: 'personal', key: 'ID Number', value: f.id, language: 'both', appliesToPerson: f.first_name_english });
  entries.push({ category: 'personal', key: 'Birth Date', value: f.birth_date, language: 'both', appliesToPerson: f.first_name_english });
  entries.push({ category: 'personal', key: 'Role', value: 'father', language: 'both', appliesToPerson: f.first_name_english });
  entries.push({ category: 'contact', key: 'Phone', value: f.phone, language: 'both', appliesToPerson: f.first_name_english });
  entries.push({ category: 'contact', key: 'Email', value: f.email, language: 'both', appliesToPerson: f.first_name_english });
  if (f.email_alt) entries.push({ category: 'contact', key: 'Email (Alt)', value: f.email_alt, language: 'both', appliesToPerson: f.first_name_english });

  // Mother
  const m = familyData.mother;
  entries.push({ category: 'personal', key: 'First Name (EN)', value: m.first_name_english, language: 'en', appliesToPerson: m.first_name_english });
  entries.push({ category: 'personal', key: 'First Name (HE)', value: m.first_name_hebrew, language: 'he', appliesToPerson: m.first_name_english });
  entries.push({ category: 'personal', key: 'Full Name (EN)', value: m.full_name_english, language: 'en', appliesToPerson: m.first_name_english });
  entries.push({ category: 'personal', key: 'Full Name (HE)', value: m.full_name_hebrew, language: 'he', appliesToPerson: m.first_name_english });
  entries.push({ category: 'personal', key: 'ID Number', value: m.id, language: 'both', appliesToPerson: m.first_name_english });
  entries.push({ category: 'personal', key: 'Birth Date', value: m.birth_date, language: 'both', appliesToPerson: m.first_name_english });
  entries.push({ category: 'personal', key: 'Role', value: 'mother', language: 'both', appliesToPerson: m.first_name_english });
  entries.push({ category: 'contact', key: 'Phone', value: m.phone, language: 'both', appliesToPerson: m.first_name_english });
  entries.push({ category: 'contact', key: 'Email', value: m.email, language: 'both', appliesToPerson: m.first_name_english });

  // Children
  for (const child of familyData.children) {
    const personName = child.first_name_english;
    entries.push({ category: 'personal', key: 'First Name (EN)', value: child.first_name_english, language: 'en', appliesToPerson: personName });
    entries.push({ category: 'personal', key: 'First Name (HE)', value: child.first_name_hebrew, language: 'he', appliesToPerson: personName });
    entries.push({ category: 'personal', key: 'Full Name (EN)', value: child.full_name_english, language: 'en', appliesToPerson: personName });
    entries.push({ category: 'personal', key: 'Full Name (HE)', value: child.full_name_hebrew, language: 'he', appliesToPerson: personName });
    entries.push({ category: 'personal', key: 'ID Number', value: child.id, language: 'both', appliesToPerson: personName });
    entries.push({ category: 'personal', key: 'Birth Date', value: child.birth_date, language: 'both', appliesToPerson: personName });
    entries.push({ category: 'personal', key: 'Role', value: 'child', language: 'both', appliesToPerson: personName });
    if (child.email) entries.push({ category: 'contact', key: 'Email', value: child.email, language: 'both', appliesToPerson: personName });
    if (child.school) {
      entries.push({ category: 'school', key: 'School Name (EN)', value: child.school.name_english || '', language: 'en', appliesToPerson: personName });
      entries.push({ category: 'school', key: 'School Name (HE)', value: child.school.name_hebrew || '', language: 'he', appliesToPerson: personName });
      if (child.school.grade) entries.push({ category: 'school', key: 'Grade', value: child.school.grade, language: 'both', appliesToPerson: personName });
      if (child.school.city_english) entries.push({ category: 'school', key: 'School City (EN)', value: child.school.city_english, language: 'en', appliesToPerson: personName });
      if (child.school.city_hebrew) entries.push({ category: 'school', key: 'School City (HE)', value: child.school.city_hebrew, language: 'he', appliesToPerson: personName });
    }
  }

  // Medical
  if (familyData.medical) {
    const med = familyData.medical;
    if (med.diagnosis) {
      entries.push({ category: 'medical', key: 'Diagnosis', value: med.diagnosis, language: 'both', appliesToPerson: null });
    }
    if (med.diagnosis_year) {
      entries.push({ category: 'medical', key: 'Diagnosis Year', value: String(med.diagnosis_year), language: 'both', appliesToPerson: null });
    }
    if (med.diagnosing_doctor) {
      entries.push({ category: 'medical', key: 'Diagnosing Doctor', value: med.diagnosing_doctor, language: 'both', appliesToPerson: null });
    }
    if (med.diagnosing_institution) {
      entries.push({ category: 'medical', key: 'Diagnosing Institution', value: med.diagnosing_institution, language: 'both', appliesToPerson: null });
    }
    if (med.diagnosing_institution_hebrew) {
      entries.push({ category: 'medical', key: 'Diagnosing Institution (HE)', value: med.diagnosing_institution_hebrew, language: 'he', appliesToPerson: null });
    }
    if (med.applies_to) {
      for (const name of med.applies_to) {
        entries.push({ category: 'medical', key: 'ASD Diagnosis', value: `Diagnosed ${med.diagnosis_year || 2016}`, language: 'both', appliesToPerson: name });
      }
    }
  }

  // Insert all entries (skip duplicates by checking existing)
  let inserted = 0;
  for (const entry of entries) {
    if (!entry.value || entry.value.trim() === '') continue;
    const existing = await prisma.knowledgeEntry.findFirst({
      where: {
        key: entry.key,
        appliesToPerson: entry.appliesToPerson,
        language: entry.language,
        isActive: true,
      },
    });
    if (!existing) {
      await prisma.knowledgeEntry.create({
        data: {
          ...entry,
          source: 'initial_seed',
        },
      });
      inserted++;
    }
  }
  console.log(`  ✓ Knowledge base: ${inserted} entries inserted (${entries.length} total)`);

  console.log('Seeding complete!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
