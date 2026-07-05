import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const httpsAgent = process.env.PROXY_URL
  ? new HttpsProxyAgent(process.env.PROXY_URL)
  : undefined;

const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
};

export async function scrapeGithub(username: string) {
  const [userRes, reposRes] = await Promise.all([
    axios.get(`https://api.github.com/users/${username}`, { httpsAgent, headers }),
    axios.get(`https://api.github.com/users/${username}/repos?sort=pushed&per_page=10`, { httpsAgent, headers }),
  ]);

  const user = userRes.data;
  const repos = reposRes.data;

  // Fetch languages for each repo in parallel
  const reposWithLangs = await Promise.all(
    repos.map(async (repo: any) => {
      try {
        const langRes = await axios.get(
          `https://api.github.com/repos/${repo.full_name}/languages`,
          { httpsAgent, headers }
        );
        return {
          name: repo.name,
          description: repo.description ?? "",
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          languages: Object.keys(langRes.data),
          topics: repo.topics ?? [],
          isForked: repo.fork,
        };
      } catch {
        return {
          name: repo.name,
          description: repo.description ?? "",
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          languages: [],
          topics: repo.topics ?? [],
          isForked: repo.fork,
        };
      }
    })
  );

  // Aggregate all languages across repos
  const languageCount: Record<string, number> = {};
  for (const repo of reposWithLangs) {
    for (const lang of repo.languages) {
      languageCount[lang] = (languageCount[lang] ?? 0) + 1;
    }
  }
  const topLanguages = Object.entries(languageCount)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);

  return {
    profile: {
      username: user.login,
      name: user.name ?? user.login,
      bio: user.bio ?? "",
      publicRepos: user.public_repos,
      followers: user.followers,
    },
    topLanguages,
    repos: reposWithLangs.filter((r) => !r.isForked),
  };
}
