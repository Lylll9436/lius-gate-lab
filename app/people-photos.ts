// Compatibility export. Maintain photos in content/lab.json.
import { peopleRecords, personContentId } from './lab-records';
export const personPhotos: Record<string, string | null> = Object.fromEntries(
  peopleRecords.map((p) => [personContentId(p), p.photo]),
);
