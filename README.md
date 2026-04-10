# @hydrooj/userimport-domain

## Column layout

```
3 cols: email  username  password
4 cols: email  username  password  domain
5 cols: email  username  password  domain  role
6 cols: email  username  password  displayName  domain  role
```

`domain` = domain ID (`system`) or display name (`c++`) — both work.  
`role` = any role in that domain (`stu`, `default`, etc).

## Example

```
foo13@example.com,user13,password13,system,stu
foo13@example.com,user13,password13,c++,stu
```

**Preview** shows exactly what each line parsed as — including column count, domain, role — so you can verify before committing.

## Install

```bash
# Remove old templates if present
rm -f /path/to/addon/templates/manage_user_import.html

hydrooj addon add /path/to/userimport-addon
pm2 restart hydrooj
```
