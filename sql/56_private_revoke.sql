-- 56: تحصين إضافي — دوال المخطط الخاص (private) لا يستدعيها إلا دوال المنصة الآمنة (security definer)
--     (المخطط أصلًا غير متاح للمستخدمين، وهذا سحب صريح لصلاحية التنفيذ احتياطًا)
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
