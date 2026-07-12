import axios from 'axios';
import { ICPFilterProfile } from './synthesize-icp';

export interface ApolloOrganization {
    id: string;
    name: string;
    website_url: string;
    industry: string;
    employee_count: number;
    short_description: string;
    keywords: string[];
}

export async function runApolloLookalikeQueries(
    profile: ICPFilterProfile
): Promise<ApolloOrganization[]> {
    const results: ApolloOrganization[] = [];
    const seen = new Set<string>();

    for (const variant of profile.queryVariants) {
        try {
            const { data } = await axios.post(
                'https://api.apollo.io/v1/mixed_companies/search',
                {
                    q_organization_keyword_tags: profile.keywords,
                    organization_industry_tag_ids: [],
                    q_keywords: variant,
                    organization_num_employees_ranges: profile.employeeSizeBands.map(
                        b => `${b.min},${b.max}`
                    ),
                    page: 1,
                    per_page: 25,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': process.env.APOLLO_API_KEY!,
                    },
                }
            );

            const orgs: ApolloOrganization[] = data.organizations ?? [];
            for (const org of orgs) {
                if (org.id && !seen.has(org.id)) {
                    seen.add(org.id);
                    results.push(org);
                }
            }


            await new Promise(r => setTimeout(r, 600));
        } catch (err: any) {
            console.error(`Apollo query failed for variant "${variant}":`, err.message);
        }
    }

    return results;
}