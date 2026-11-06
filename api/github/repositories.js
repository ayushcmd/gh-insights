import { endpoint, username } from "../../lib/api-helpers.js";
import { getRepositories } from "../../lib/github.js";

export default endpoint(async (req) => getRepositories(username(req)), { methods: ["GET"] });
