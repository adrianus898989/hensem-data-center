-- M8 multilingual rejection templates, ported from the static arwd.py whitelist.
-- Match complete templates within the collected note, including a short UI
-- preview followed by the full tooltip. Never classify a truncated fragment.
-- Formatting normalization is used only for matching; the source stays intact.
-- Includes all untagged templates in BR, ID, MM, MY and VN; tagged IN/PK/NG
-- and shared English templates are handled by the reason-category function.
begin;
create or replace function private.dashboard_admin_live_rejection_normalize(p_country_code text,p_note text)
returns text language sql immutable parallel safe set search_path='' as $fn$
 select btrim(regexp_replace(regexp_replace(
  -- The Myanmar source renderer omits this combining dot in otherwise identical
  -- whitelist text. Bank/wallet names and day/month words remain significant.
  case when p_country_code='MM' then replace(note,chr(4151),'') else note end,
  $punct$[\[\]【】()（）{}<>.,:：;；!！?？_/"“”'‘’…-]+$punct$,' ','g'),
  '[[:space:]]+',' ','g'))
 from (select regexp_replace(replace(lower(coalesce(p_note,'')),chr(160),' '),
   '<br[[:space:]]*/?>',' ','gi') note) n
$fn$;
revoke all on function private.dashboard_admin_live_rejection_normalize(text,text) from public,anon,authenticated;

create or replace function private.dashboard_admin_live_rejection_template(p_country_code text,p_note text)
returns text language sql immutable parallel safe set search_path='' as $fn$
 with templates as (select $templates${
  "BR": {
    "o membro solicitou o cancelamento da retirada, obrigado": "会员申请取消",
    "olá, a falha foi causada por uma falha do sistema, por favor, solicite a retirada novamente, obrigado": "系统失败 / 重新提交",
    "olá, como as informações do seu cpf estão erradas, entre em contato com o atendimento online para verificação, obrigado": "CPF 资料错误",
    "olá, como os dados do seu pix estão errados, entre em contato com o atendimento online para verificar a alteração, obrigado": "PIX 资料错误",
    "olá, como seu cartão bancário atingiu o limite diário, você não pode sacar dinheiro, obrigado": "银行每日额度限制",
    "olá, entre em contato com o atendimento ao cliente online para consulta, obrigado": "联系客服核实",
    "olá, foi verificado que você violou as regras do jogo, entre em contato com o atendimento ao cliente online para consulta, obrigado": "违反游戏规则",
    "olá, o banco está em manutenção do sistema e não pode retirar fundos temporariamente, aguarde pacientemente, obrigado": "银行维护",
    "olá, seu cartão bancário atingiu o limite diário e não é possível realizar saques. obrigado.": "银行每日额度限制",
    "olá, você ainda não atingiu o rollover de 1× do valor do depósito, faça um saque após atingir o requisito, obrigado": "充值流水未满足",
    "você não recarrega há muito tempo, entre em contato com o atendimento ao cliente. para saber mais sobre o processo de saque. obrigado": "长期未充值"
  },
  "ID": {
    "penarikan melalui e-wallet tidak dapat diproses untuk jumlah besar. harap melakukan penarikan sesuai limit yang ditentukan, atau dapat mengganti metode penarikan ke rekening bank.": "钱包大额提现限制",
    "sistem kami mendeteksi adanya kecurangan dalam permainan anda. silakan hubungi customer service untuk infomasi lebih lanjut.": "游戏作弊",
    "yth. e-wallet yang anda gunakan telah mencapai limit penarikan harian/bulanan. disarankan anda untuk mengganti metode penarikan ke rekening bank.": "钱包日 / 月额度限制",
    "yth. kami informasikan bahwa data e-wallet anda tidak sesuai. silakan hubungi customer service kami untuk pergantian data rekening dan melakukan penarikan kembali.": "钱包资料错误",
    "yth. kami informasikan bahwa data rekening bank anda tidak sesuai. silakan hubungi customer service kami untuk pergantian data rekening dan melakukan penarikan kembali.": "银行资料错误",
    "yth. saat ini, bank/e-wallet yang anda gunakan sedang offline, sehingga penarikan dana tidak dapat diproses. harap mencoba kembali melakukan penarikan dana anda. terima kasih": "银行 / 钱包离线",
    "yth. untuk mendapatkan informasi lebih lanjut, silahkan hubungi layanan customer service kami. terima kasih": "联系客服核实"
  },
  "MM": {
    "မိတ်ဆွေရဲ့ဘဏ်/e-wallet က လက်ရှိမှာ အော့ဖ်လိုင်းဖြစ်နေသဖြင့် ငွေထုတ်ယူလို့မရပါဘူး။နောက်ထပ်မံကြိုးစားကြည့်ပါ။ ကျေးဇူးတင်ပါတယ်။": "银行 / 钱包离线",
    "လိုအပ်သောလိုအပ်အချက်အလက်များအတွက် ကျွန်ုပ်တို့၏ ဖောက်သည်ဝန်ဆောင်သို့ဆက်သွယ်ပါ။ ကျေးဇူးတင်ပါသည်။": "联系客服核实",
    "လူကြီးမင်း e-wallet သည် နေ့စဉ် ငွေထုတ်ယူနိုင်သည့် ကန့်သတ်ချက် ပမာဏ ရောက်ရှိသွားပါပြီ။ ငွေထပ်မံ ထုတ်ယူရန် အခြားဘဏ်အကောင့် အသုံးပြုရန် အကြံပြုအပ်ပါသည်။": "钱包每日额度限制",
    "လူကြီးမင်း e-wallet သည် လစဉ် ငွေထုတ်ယူနိုင်သည့် ကန့်သတ်ချက် ပမာဏ ရောက်ရှိသွားပါပြီ။ ငွေထပ်မံ ထုတ်ယူရန် အခြားဘဏ်အကောင့် အသုံးပြုရန် အကြံပြုအပ်ပါသည်။": "钱包每月额度限制",
    "လူကြီးမင်း kbz pay (e-wallet) သည် နေ့စဉ် ငွေထုတ်ယူနိုင်သည့် ကန့်သတ်ချက် ပမာဏ ရောက်ရှိသွားပါပြီ။ ငွေထပ်မံ ထုတ်ယူရန် အခြားဘဏ်အကောင့် အသုံးပြုရန် အကြံပြုအပ်ပါသည်။": "KBZ Pay 每日额度限制",
    "လူကြီးမင်း kbz pay (e-wallet) သည် လစဉ် ငွေထုတ်ယူနိုင်သည့် ကန့်သတ်ချက် ပမာဏ ရောက်ရှိသွားပါပြီ။ ငွေထပ်မံ ထုတ်ယူရန် အခြားဘဏ်အကောင့် အသုံးပြုရန် အကြံပြုအပ်ပါသည်။": "KBZ Pay 每月额度限制",
    "လူကြီးမင်း wave pay (e-wallet) သည် နေ့စဉ် ငွေထုတ်ယူနိုင်သည့် ကန့်သတ်ချက် ပမာဏ ရောက်ရှိသွားပါပြီ။ ငွေထပ်မံ ထုတ်ယူရန် အခြားဘဏ်အကောင့် အသုံးပြုရန် အကြံပြုအပ်ပါသည်။": "Wave Pay 每日额度限制",
    "လူကြီးမင်း wave pay (e-wallet) သည် လစဉ် ငွေထုတ်ယူနိုင်သည့် ကန့်သတ်ချက် ပမာဏ ရောက်ရှိသွားပါပြီ။ ငွေထပ်မံ ထုတ်ယူရန် အခြားဘဏ်အကောင့် အသုံးပြုရန် အကြံပြုအပ်ပါသည်။": "Wave Pay 每月额度限制",
    "လူကြီးမင်း ဂိမ်းတွင် မသမာမှုကို တွေ့ရှိထားပါသည်။ လိုအပ်သောအချက်အလက်များအတွက် ဖောက်သည်ဝန်ဆောင်မှုကို ဆက်သွယ်ပါ။": "游戏作弊",
    "လူကြီးမင်း ၏ kbz pay(e-wallet) အချက်အလက်များ မှားယွင်းနေပါသည်။ သင့်အကောင့်အချက်အလက်များကို ပြောင်းလဲရန်နှင့် ငွေထုတ်ယူရန် ကျွန်ုပ်တို့၏ ဖောက်သည်ဝန်ဆောင်မှုဌာနသို့ ဆက်သွယ်ပါ။": "KBZ Pay 资料错误",
    "လူကြီးမင်း ၏ wave pay (e-wallet) အချက်အလက်များ မှားယွင်းနေပါသည်။ သင့်အကောင့်အချက်အလက်များကို ပြောင်းလဲရန်နှင့် ငွေထုတ်ယူရန် ကျွန်ုပ်တို့၏ ဖောက်သည်ဝန်ဆောင်မှုဌာနသို့ ဆက်သွယ်ပါ။": "Wave Pay 资料错误",
    "လူကြီးမင်း ၏ ဘဏ် အချက်အလက်များ မှားယွင်းနေပါသည်။ သင့်ဘဏ်အကောင့်အချက်အလက်များကို ပြုပြင်ရန်နှင့် ငွေထုတ်ယူရန် ကျွန်ုပ်တို့၏ ဖောက်သည်ဝန်ဆောင်မှုဌာနသို့ ဆက်သွယ်ပါ။": "银行资料错误"
  },
  "MY": {
    "ahli yang dihormati, kerana kad bank atau nama anda salah, silakan anda hubungi customer service.": "银行卡 / 姓名错误",
    "akaun anda telah dikesan menggunakan berbilang alamat ip dan permohonan anda telah ditolak kerana tidak memenuhi terma dan syarat bonus.": "多 IP / 奖励条件未满足",
    "anda telah mencapai had maksimum jemputan dan putaran yang boleh dikeluarkan hari ini. sila cuba lagi esok. terima kasih.": "邀请 / 转盘当日次数上限",
    "dear customer, please contact our online customer service, thank you.": "联系客服核实",
    "dear member, if your bank card or name is incorrect, please contact customer service.": "银行卡 / 姓名错误",
    "hello, kerana kad bank anda sedang diselenggara, sistem secara automatik akan menolak pengeluaran anda，terima kasih": "银行维护",
    "hello, kerana usdt-trc sedang diselenggara, sistem secara automatik akan menolak pengeluaran anda，terima kasih.": "USDT-TRC 维护",
    "hello, since usdt-trc is currently under maintenance, your withdrawal request will be automatically rejected. thank you.": "USDT-TRC 维护",
    "hello, your bank card is currently under maintenance, so the system will automatically reject your payment. thank you.": "银行维护",
    "mohon maaf ,silahkan membuat penghantaran semula permohonan pengeluaran kerana gangguan sistem bank. terima kasih.": "银行系统故障 / 重新提交",
    "permohonan anda telah ditolak kerana tidak memenuhi terma dan syarat bonus. sila hubungi mentor anda untuk maklumat lanjut.": "奖励条件未满足",
    "sayang, sila hubungi perkhidmatan pelanggan dalam talian kami, terima kasih": "联系客服核实",
    "sistem mengesan bahawa pertaruhan anda mencurigakan, sila hubungi customer service. terima kasih.": "可疑投注",
    "the system has detected suspicious activity regarding your bets. please contact customer service. thank you.": "可疑投注",
    "you have reached the maximum number of invitations and spins that can be sent today. please try again tomorrow. thank you.": "邀请 / 转盘当日次数上限",
    "your account has been found to be using multiple ip addresses, and your application has been rejected for not meeting the reward terms and conditions.": "多 IP / 奖励条件未满足",
    "your application has been rejected due to not meeting the reward terms and conditions. please contact your mentor for more information.": "奖励条件未满足"
  },
  "VN": {
    "giao dịch rút tiền của bạn bị từ chối. vui lòng liên hệ bộ phận chăm sóc khách hàng để xác minh thông tin usdt của bạn. cảm ơn.": "USDT 信息待核实",
    "ngân hàng của quý khách đang bảo trì , vui lòng tiến hành rút tiền sau khi bảo trì xong , xin cảm ơn !": "银行维护",
    "quý khách chưa đủ điều kiện rút usdt vui lòng liên hệ cskh để hỗ trợ . xin cảm ơn !": "USDT 提现条件未满足",
    "thông tin ngân hàng của quý khách không chính xác ,vui lòng liên hệ cskh để hỗ trợ , xin cảm ơn !": "银行资料错误",
    "vui lòng liên hệ cskh để được hỗ trợ, xin cảm ơn !": "联系客服核实",
    "đơn cược của quý khách đã vi phạm quy tắc đặt cược , vui lòng liên hệ cskh để biết thêm chi tiết.": "违反投注规则"
  }
}$templates$::jsonb -> p_country_code as items),
 note as materialized (select private.dashboard_admin_live_rejection_normalize(p_country_code,p_note) text)
 select case when count(distinct t.value)=1 then min(t.value) end
 from templates cross join lateral jsonb_each_text(coalesce(items,'{}'::jsonb)) t cross join note
 where position(private.dashboard_admin_live_rejection_normalize(p_country_code,t.key) in note.text)>0
$fn$;
revoke all on function private.dashboard_admin_live_rejection_template(text,text) from public,anon,authenticated;
commit;
