export async function onRequestGet({ env, request, waitUntil }) {
    if (!env.GITHUB_TOKEN) {
        return jsonResponse({ error: 'GITHUB_TOKEN is not configured.' }, 503);
    }

    let result = await caches.default.match(request.url);
    if (result) {
        result = await result.json();
        if (!result || result.version !== 5 || !Array.isArray(result.repositories) ||
            !Array.isArray(result.stats) || !Array.isArray(result.languages)) result = null;
    }

    if (!result) {
        result = await fetchData(env);
        waitUntil(updateCache(request.url, result));
    }

    return jsonResponse(result);
}

function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
        headers: {
            'content-type': 'application/json',
            'cache-control': 'no-cache, no-store, must-revalidate, max-age=0'
        }
    });
}

async function fetchData(env) {
    const repositoryQuery = `query($after: String) {
        user(login: "itsfourvn") {
            id
            createdAt
            repositories(
                first: 100
                after: $after
                ownerAffiliations: OWNER
                privacy: PUBLIC
                orderBy: { field: UPDATED_AT, direction: DESC }
            ) {
                nodes {
                    name
                    description
                    url
                    primaryLanguage { name color }
                    stargazerCount
                    forkCount
                }
                pageInfo { endCursor hasNextPage }
            }
        }
    }`;

    let repositories = [];
    let profile;
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
        const data = await fetchGitHubGraphQL(env, repositoryQuery, { after: cursor });
        const user = data.user;
        if (!user?.repositories?.pageInfo) throw new Error('GitHub did not return repository data.');

        profile = user;
        repositories = repositories.concat(user.repositories.nodes);
        cursor = user.repositories.pageInfo.endCursor;
        hasNextPage = user.repositories.pageInfo.hasNextPage;
    }

    const currentYear = new Date().getUTCFullYear();
    const firstYear = new Date(profile.createdAt).getUTCFullYear();
    const yearFields = [];
    for (let year = firstYear; year <= currentYear; year++) {
        yearFields.push(`year${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${year + 1}-01-01T00:00:00Z") {
            contributionCalendar { totalContributions }
            commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } }
        }`);
    }

    const contributionData = await fetchGitHubGraphQL(env, `{
        user(login: "itsfourvn") { ${yearFields.join('\n')} }
    }`);
    const contributedRepositories = new Set();
    let allTimeContributions = 0;
    for (let year = firstYear; year <= currentYear; year++) {
        const contributions = contributionData.user?.[`year${year}`];
        if (!contributions) throw new Error(`GitHub did not return contributions for ${year}.`);
        allTimeContributions += contributions.contributionCalendar.totalContributions;
        for (const contribution of contributions.commitContributionsByRepository) {
            if (contribution.repository?.nameWithOwner) {
                contributedRepositories.add(contribution.repository.nameWithOwner);
            }
        }
    }

    const [linesChanged, repositoryViews, languages] = await Promise.all([
        getLinesChanged(env, repositories, profile.id),
        getRepositoryViews(env, repositories),
        getGitHubLanguages()
    ]);
    const stats = [
        repositories.reduce((sum, repo) => sum + repo.stargazerCount, 0),
        repositories.reduce((sum, repo) => sum + repo.forkCount, 0),
        allTimeContributions,
        linesChanged,
        repositoryViews,
        contributedRepositories.size
    ];
    return { version: 5, repositories, stats, languages };
}

async function fetchGitHubGraphQL(env, query, variables = {}) {
    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'authorization': `bearer ${env.GITHUB_TOKEN}`,
            'user-agent': 'itsfourvn-site'
        },
        body: JSON.stringify({ query, variables })
    });
    const payload = await response.json();
    if (!response.ok || payload.errors?.length) {
        console.error('GitHub GraphQL request failed:', response.status, payload.errors);
        throw new Error('Failed to load GitHub profile data.');
    }
    return payload.data;
}

async function getLinesChanged(env, repositories, authorId) {
    const changes = await Promise.all(repositories.map(async repository => {
        let total = 0;
        let cursor = null;
        let hasNextPage = true;

        while (hasNextPage) {
            const data = await fetchGitHubGraphQL(env, `query($owner: String!, $name: String!, $authorId: ID!, $after: String) {
                repository(owner: $owner, name: $name) {
                    defaultBranchRef {
                        target {
                            ... on Commit {
                                history(first: 100, after: $after, author: { id: $authorId }) {
                                    nodes { additions deletions }
                                    pageInfo { endCursor hasNextPage }
                                }
                            }
                        }
                    }
                }
            }`, {
                owner: 'itsfourvn',
                name: repository.name,
                authorId,
                after: cursor
            });

            const history = data.repository?.defaultBranchRef?.target?.history;
            if (!history) break;
            total += history.nodes.reduce((sum, commit) => sum + commit.additions + commit.deletions, 0);
            cursor = history.pageInfo.endCursor;
            hasNextPage = history.pageInfo.hasNextPage;
        }
        return total;
    }));

    return changes.reduce((sum, value) => sum + value, 0);
}

async function getRepositoryViews(env, repositories) {
    const views = await Promise.all(repositories.map(async repository => {
        const response = await fetch(`https://api.github.com/repos/itsfourvn/${encodeURIComponent(repository.name)}/traffic/views`, {
            headers: {
                'accept': 'application/vnd.github+json',
                'authorization': `Bearer ${env.GITHUB_TOKEN}`,
                'user-agent': 'itsfourvn-site',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        if (!response.ok) {
            console.error(`GitHub traffic request failed for ${repository.name}:`, response.status);
            return null;
        }

        const data = await response.json();
        return Number.isSafeInteger(data.count) ? data.count : null;
    }));

    return views.every(value => value !== null)
        ? views.reduce((sum, value) => sum + value, 0)
        : '-';
}

async function getGitHubLanguages() {
    const response = await fetch('https://raw.githubusercontent.com/itsfourvn/itsfourvn/main/generated/languages.svg', {
        headers: { 'user-agent': 'itsfourvn-site' }
    });
    if (!response.ok) {
        throw new Error(`Failed to load generated GitHub language data: ${response.status}`);
    }

    const svg = await response.text();
    const languages = [];
    for (const [, item] of svg.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const colorMatch = item.match(/<svg\b[^>]*style="[^"]*fill:\s*(#[\da-f]{3,8})/i);
        const nameMatch = item.match(/<span\b[^>]*class="lang"[^>]*>([\s\S]*?)<\/span>/i);
        const percentageMatch = item.match(/<span\b[^>]*class="percent"[^>]*>\s*([\d.]+)\s*%/i);
        if (!colorMatch || !nameMatch || !percentageMatch) {
            throw new Error('Generated GitHub language data has an unexpected format.');
        }

        const name = decodeHtml(nameMatch[1].trim());
        const percentage = Number(percentageMatch[1]);
        if (!name || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
            throw new Error('Generated GitHub language data contains an invalid entry.');
        }
        languages.push({ name, color: colorMatch[1], percentage });
    }

    if (!languages.length) {
        throw new Error('Generated GitHub language data did not contain any languages.');
    }
    return languages;
}

function decodeHtml(value) {
    const entities = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' '
    };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
        if (code[0] !== '#') return entities[code.toLowerCase()] ?? entity;
        const number = code[1].toLowerCase() === 'x'
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
            ? String.fromCodePoint(number)
            : entity;
    });
}

async function updateCache(url, data) {
    if (data === undefined) return;
    await caches.default.put(url, new Response(JSON.stringify(data), {
        headers: {
            'content-type': 'application/json',
            'cache-control': 'public, max-age=3600'
        }
    }));
}