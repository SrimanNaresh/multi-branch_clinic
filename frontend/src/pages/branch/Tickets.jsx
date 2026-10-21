import { useAuth } from '../../lib/auth.jsx';
import { useT } from '../../lib/i18n.jsx';
import { Card, Empty, PageHeader } from '../../components/ui.jsx';

// Communication → Tickets
export default function Tickets() {
  const { t } = useT();
  const auth = useAuth();
  return (
    <>
      <PageHeader title={t('menu.tickets')} subtitle={auth.activeClinic?.name} />
      <Card>
        <Empty>{t('tickets.empty')}</Empty>
      </Card>
    </>
  );
}
