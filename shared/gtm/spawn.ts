/** Public subset only. Heading is compass degrees: north=0, east=90. */
export interface CompanySpawn {
  slug: string;
  lat: number;
  lon: number;
  heading: number;
  headingUnit: 'degrees';
  building_id: string;
}
export function validCompanySlug(slug:string):boolean {return /^[a-z0-9][a-z0-9-]{0,95}$/.test(slug);}
