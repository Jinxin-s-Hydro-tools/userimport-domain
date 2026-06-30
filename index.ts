import { Context, Handler, param, PRIV, Types, db } from 'hydrooj';

const RE_MAIL = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/i;
const RE_UNAME = /^.{1,254}$/i;
const isEmail = (s: string) => RE_MAIL.test(s);
const isUname = (s: string) => RE_UNAME.test(s);
const isPassword = (s: string) => s && s.length >= 5;

const collDomain = db.collection('domain');

async function resolveDomain(input: string): Promise<any | null> {
    const DomainModel = global.Hydro.model.domain;
    const byId = await DomainModel.get(input);
    if (byId) return byId;
    return await collDomain.findOne({ name: input }) ?? null;
}

function parseLine(raw: string, lineNum: number) {
    let cols = raw.split(',').map((t) => t.trim());
    if (!cols[0] || !cols[1] || !cols[2]) cols = raw.split('\t').map((t) => t.trim());
    while (cols.length > 0 && !cols[cols.length - 1]) cols.pop();
    const [email, username, password] = cols;
    if (!email || !username || !password) return null;
    let displayName: string | undefined;
    let domainInput: string | undefined;
    let role: string | undefined;
    switch (cols.length) {
        case 3: break;
        case 4: domainInput = cols[3]; break;
        case 5: domainInput = cols[3]; role = cols[4]; break;
        default:
            displayName = cols[3] || undefined;
            domainInput = cols[4] || undefined;
            role = cols[5] || undefined;
    }
    return { lineNum, email, username, password, displayName, domainInput, role };
}

function parsePwdLine(raw: string, lineNum: number) {
    let cols = raw.split(',').map((t) => t.trim());
    if (cols.length < 2) cols = raw.split('\t').map((t) => t.trim());
    const [username, password] = cols;
    if (!username || !password) return null;
    return { lineNum, username, password };
}

class UserImportDomainHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }

    async get() {
        this.response.redirect = this.url('manage_user_import');
    }

    @param('users', Types.Content)
    @param('draft', Types.Boolean)
    async post(domainId: string, _users: string, draft: boolean) {
        const UserModel = global.Hydro.model.user;
        const DomainModel = global.Hydro.model.domain;
        const messages: string[] = [];
        const validRows: any[] = [];
        const domainCache = new Map<string, any>();
        const roleCache = new Map<string, Set<string>>();

        // Track duplicates within the current input batch
        const seenEmails = new Map<string, number>();    // email -> first lineNum
        const seenUsernames = new Map<string, number>(); // username -> first lineNum

        for (const [i, u] of _users.split('\n').entries()) {
            if (!u.trim()) continue;
            const row = parseLine(u, i + 1);
            if (!row) { messages.push(`Line ${i + 1}: Input invalid.`); continue; }
            if (!isEmail(row.email)) { messages.push(`Line ${row.lineNum}: Invalid email.`); continue; }
            if (!isUname(row.username)) { messages.push(`Line ${row.lineNum}: Invalid username.`); continue; }
            if (!isPassword(row.password)) { messages.push(`Line ${row.lineNum}: Invalid password.`); continue; }

            // Check duplicates within this batch first
            const emailKey = row.email.toLowerCase();
            const unameKey = row.username.toLowerCase();
            if (seenEmails.has(emailKey)) {
                messages.push(`Line ${row.lineNum}: Email ${row.email} duplicates line ${seenEmails.get(emailKey)}.`);
                continue;
            }
            if (seenUsernames.has(unameKey)) {
                messages.push(`Line ${row.lineNum}: Username ${row.username} duplicates line ${seenUsernames.get(unameKey)}.`);
                continue;
            }

            // Then check against the database
            if (await UserModel.getByEmail('system', row.email)) { messages.push(`Line ${row.lineNum}: Email ${row.email} already exists in database.`); continue; }
            if (await UserModel.getByUname('system', row.username)) { messages.push(`Line ${row.lineNum}: Username ${row.username} already exists in database.`); continue; }

            // Record as seen
            seenEmails.set(emailKey, row.lineNum);
            seenUsernames.set(unameKey, row.lineNum);

            let resolvedDomainId: string | undefined;
            if (row.domainInput) {
                if (!domainCache.has(row.domainInput)) {
                    domainCache.set(row.domainInput, await resolveDomain(row.domainInput));
                }
                const ddoc = domainCache.get(row.domainInput);
                if (!ddoc) { messages.push(`Line ${row.lineNum}: Domain "${row.domainInput}" not found.`); continue; }
                resolvedDomainId = ddoc._id;
                const desiredRole = row.role?.trim() || 'default';
                if (!roleCache.has(ddoc._id)) {
                    const list: any[] = await DomainModel.getRoles(ddoc);
                    roleCache.set(ddoc._id, new Set(list.map((r: any) => r._id)));
                }
                if (!roleCache.get(ddoc._id)!.has(desiredRole)) {
                    messages.push(`Line ${row.lineNum}: Role "${desiredRole}" not found. Available: ${[...roleCache.get(ddoc._id)!].join(', ')}`);
                    continue;
                }
            }
            messages.push(`Line ${row.lineNum}: OK ${row.email}/${row.username}${resolvedDomainId ? ` domain=${resolvedDomainId} role=${row.role?.trim() || 'default'}` : ''}`);
            validRows.push({ ...row, resolvedDomainId });
        }
        messages.push(`${validRows.length} users found.`);

        if (!draft) {
            for (const row of validRows) {
                try {
                    const uid = await UserModel.create(row.email, row.username, row.password);
                    if (row.resolvedDomainId) {
                        const role = row.role?.trim() || 'default';
                        await DomainModel.setUserRole(row.resolvedDomainId, uid, role, true);
                        messages.push(`${row.username}: created, enrolled in "${row.resolvedDomainId}" as "${role}".`);
                    } else {
                        messages.push(`${row.username}: created.`);
                    }
                } catch (e: any) {
                    messages.push(`${row.username}: ERROR — ${e.message}`);
                }
            }
        }
        this.response.body = { users: validRows, messages };
    }
}

class BatchChangePwdHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }

    async get() {
        this.response.redirect = this.url('manage_user_import');
    }

    @param('users', Types.Content)
    @param('draft', Types.Boolean)
    async post(domainId: string, _users: string, draft: boolean) {
        const UserModel = global.Hydro.model.user;
        const messages: string[] = [];
        const validRows: Array<{ lineNum: number; username: string; password: string; uid: number }> = [];
        const seenUsernames = new Map<string, number>();

        for (const [i, u] of _users.split('\n').entries()) {
            const trimmed = u.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const row = parsePwdLine(u, i + 1);
            if (!row) {
                messages.push(`Line ${i + 1}: Input invalid — expected "username, password".`);
                continue;
            }
            if (!isUname(row.username)) {
                messages.push(`Line ${row.lineNum}: Invalid username "${row.username}".`);
                continue;
            }
            if (!isPassword(row.password)) {
                messages.push(`Line ${row.lineNum}: Invalid password (minimum 5 characters).`);
                continue;
            }

            const unameKey = row.username.toLowerCase();
            if (seenUsernames.has(unameKey)) {
                messages.push(`Line ${row.lineNum}: Username "${row.username}" duplicates line ${seenUsernames.get(unameKey)}.`);
                continue;
            }
            seenUsernames.set(unameKey, row.lineNum);

            const udoc = await UserModel.getByUname('system', row.username);
            if (!udoc) {
                messages.push(`Line ${row.lineNum}: User "${row.username}" not found.`);
                continue;
            }

            if (draft) {
                messages.push(`Line ${row.lineNum}: [PREVIEW] Would change password for "${row.username}" (uid=${udoc._id}).`);
            }
            validRows.push({ lineNum: row.lineNum, username: row.username, password: row.password, uid: udoc._id });
        }

        messages.push(`${validRows.length} user(s) validated.`);

        if (!draft) {
            let ok = 0;
            let fail = 0;
            for (const row of validRows) {
                try {
                    await UserModel.setPassword(row.uid, row.password);
                    if (global.Hydro.model.token?.delByUid) {
                        await global.Hydro.model.token.delByUid(row.uid);
                    }
                    messages.push(`Line ${row.lineNum}: Password changed for "${row.username}". ✓`);
                    ok++;
                } catch (e: any) {
                    messages.push(`Line ${row.lineNum}: ERROR — ${e.message}`);
                    fail++;
                }
            }
            messages.push(`Summary: ${ok} succeeded, ${fail} failed.`);
        }

        this.response.body = { messages };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('userimport_domain', '/manage/userimport-domain', UserImportDomainHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('batch_change_pwd', '/manage/batch-change-pwd', BatchChangePwdHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.i18n.load('zh', {
        userimport_domain: '导入用户（域+角色）',
        'Import User With Domain And Role': '同时导入域和角色',
        'Users With Domain And Role': '用户列表（域和角色）',
        'Create users only.': '仅注册账号',
        'Create users and add them to domains with roles.': '同时导入域和角色',
        batch_change_pwd: '批量修改密码',
        'Batch Change Password': '批量修改密码',
        Format: '格式',
        'One entry per line, comma or tab separated:': '每行一条，逗号或制表符分隔：',
        'Lines starting with # are treated as comments and ignored.': '以 # 开头的行视为注释，将被忽略。',
        'Example:': '示例：',
        Preview: '预览',
        Execute: '执行',
        Users: '用户列表',
        Tips: '提示',
        'Use Preview first to validate your input before committing.': '建议先点击预览，确认无误后再执行。',
        'Passwords must be at least 5 characters.': '密码长度至少为5个字符。',
        'Duplicate usernames within the same batch will be skipped.': '同一批次中重复的用户名将被跳过。',
        'Changing password forces the user to re-login.': '修改密码后用户需要重新登录。',
    });
    ctx.i18n.load('en', {
        userimport_domain: 'Import User (Domain+Role)',
        'Import User With Domain And Role': 'Import User With Domain And Role',
        'Users With Domain And Role': 'Users With Domain And Role',
        'Create users only.': 'Create users only.',
        'Create users and add them to domains with roles.': 'Create users and add them to domains with roles.',
        batch_change_pwd: 'Batch Change Password',
    });
}
