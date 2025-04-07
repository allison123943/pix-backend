const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

// Configurações
const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

mercadopago.configure({ access_token: ACCESS_TOKEN });

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb'
  }
});

// Sistema de logs melhorado
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.debug(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
};

// Configuração dos PDFs - busca em múltiplos locais
const PDF_FILES = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano_casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano_familia.pdf'
};

// Função para encontrar os PDFs
function findPdfFile(filename) {
  const searchPaths = [
    path.join(__dirname, filename),            // Raiz do projeto
    path.join(__dirname, 'src', filename),    // Pasta src/
    path.join(__dirname, '..', filename)      // Nível acima (para Render)
  ];

  for (const filePath of searchPaths) {
    if (fs.existsSync(filePath)) {
      logger.info(`PDF encontrado em: ${filePath}`);
      return filePath;
    }
  }

  logger.error(`PDF não encontrado: ${filename}`);
  throw new Error(`Arquivo ${filename} não encontrado em nenhum dos locais: ${searchPaths.join(', ')}`);
}

// Verifica e mapeia os PDFs disponíveis
const planos = {};
try {
  Object.entries(PDF_FILES).forEach(([plano, arquivo]) => {
    planos[plano] = findPdfFile(arquivo);
  });
} catch (error) {
  logger.error(`Falha ao carregar PDFs: ${error.message}`);
  process.exit(1);
}

// Armazenamento temporário de pagamentos
const pagamentosPendentes = {};

// Função para enviar e-mail com PDF
async function enviarEmailComPDF(email, plano) {
  try {
    const pdfPath = planos[plano];
    if (!pdfPath) throw new Error(`Plano ${plano} não configurado`);

    const mailOptions = {
      from: 'oficialfinanzap@gmail.com',
      to: email,
      subject: 'Seu PDF do Finanzap',
      text: 'Obrigado por sua compra! Segue em anexo o PDF do seu plano.',
      attachments: [{
        filename: PDF_FILES[plano],
        path: pdfPath,
        contentType: 'application/pdf'
      }]
    };

    await transporter.sendMail(mailOptions);
    logger.info(`E-mail enviado para ${email} com o PDF: ${pdfPath}`);
  } catch (error) {
    logger.error(`Falha ao enviar e-mail para ${email}: ${error.message}`);
    throw error;
  }
}

// Webhook para processar pagamentos
app.post('/webhook', async (req, res) => {
  try {
    if (!verifySignature(req, WEBHOOK_SECRET)) {
      logger.warn('Assinatura de webhook inválida');
      return res.status(401).send('Assinatura inválida');
    }

    const event = req.body;
    logger.debug(`Evento recebido: ${JSON.stringify(event)}`);

    if (event.type === 'payment') {
      const paymentId = event.data.id;
      const payment = await mercadopago.payment.get(paymentId);
      const paymentStatus = payment.body.status;
      const externalRef = payment.body.external_reference;

      logger.info(`Processando pagamento ${paymentId} (status: ${paymentStatus})`);

      if (paymentStatus === 'approved' && pagamentosPendentes[externalRef]) {
        const { email, plano } = pagamentosPendentes[externalRef];
        try {
          await enviarEmailComPDF(email, plano);
          delete pagamentosPendentes[externalRef];
          logger.info(`Pagamento ${paymentId} processado com sucesso`);
        } catch (error) {
          logger.error(`Erro ao processar pagamento ${paymentId}: ${error.message}`);
        }
      }
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error(`Erro no webhook: ${error.message}`);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Rota para criar pagamento
app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;
    logger.info(`Solicitação de pagamento recebida para ${email} (plano: ${plano})`);

    if (!email || !plano) {
      logger.warn('Dados incompletos na requisição');
      return res.status(400).json({ error: 'Email e plano são obrigatórios' });
    }

    if (!planos[plano]) {
      logger.warn(`Plano inválido solicitado: ${plano}`);
      return res.status(400).json({ error: 'Plano inválido' });
    }

    const externalRef = uuidv4();
    const valor = plano === 'normal' ? 1.00 : 1;

    // Armazena os dados do pagamento
    pagamentosPendentes[externalRef] = { email, plano };
    logger.debug(`Pagamento armazenado: ${externalRef}`);

    const paymentData = {
      statement_descriptor: 'Finanzap',
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: 'Finanzap',
      additional_info: {
        items: [{
          id: 'finanzap_001',
          title: `Plano ${plano}`,
          description: 'Acesso ao Assistente Financeiro',
          category_id: 'services',
          quantity: 1,
          unit_price: parseFloat(valor.toFixed(2))
        }]
      },
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalRef,
      payer: { 
        email: email,
        first_name: 'Cliente',
        last_name: 'PIX',
        identification: { type: 'CPF', number: '12345678909' }
      }
    };

    const response = await mercadopago.payment.create(paymentData);

    if (response.body?.id) {
      logger.info(`Pagamento criado com sucesso: ${response.body.id}`);
      res.json({
        paymentId: response.body.id,
        qrCode: response.body.point_of_interaction?.transaction_data?.qr_code,
        qrCodeBase64: response.body.point_of_interaction?.transaction_data?.qr_code_base64,
        status: response.body.status
      });
    } else {
      delete pagamentosPendentes[externalRef];
      logger.error('Erro na resposta do Mercado Pago', response.body);
      res.status(500).json({ error: 'Erro ao criar pagamento', details: response.body });
    }
  } catch (error) {
    logger.error(`Erro ao criar pagamento: ${error.message}`);
    res.status(500).json({ error: 'Erro ao criar pagamento', details: error.message });
  }
});

// Rota para verificar status do pagamento
app.get('/status-pagamento/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    logger.debug(`Verificando status do pagamento ${paymentId}`);
    
    const response = await mercadopago.payment.get(paymentId);
    res.json({ status: response.body.status });
  } catch (error) {
    logger.error(`Erro ao verificar pagamento ${paymentId}: ${error.message}`);
    res.status(500).json({ error: 'Erro ao verificar pagamento', details: error.message });
  }
});

// Rota de debug para verificar os PDFs
app.get('/debug-pdfs', (req, res) => {
  try {
    const pdfStatus = {};
    Object.entries(PDF_FILES).forEach(([plano, arquivo]) => {
      pdfStatus[plano] = {
        nome: arquivo,
        caminho: planos[plano],
        existe: fs.existsSync(planos[plano])
      };
    });

    res.json({
      status: 'success',
      baseDir: __dirname,
      pdfs: pdfStatus,
      dirContents: fs.readdirSync(__dirname)
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Servidor iniciado na porta ${PORT}`);
  logger.info('PDFs carregados:');
  Object.entries(planos).forEach(([plano, caminho]) => {
    logger.info(`- ${plano}: ${caminho}`);
  });
});
