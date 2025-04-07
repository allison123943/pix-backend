/* [1] IMPORTAÇÕES E CONFIGURAÇÃO INICIAL */
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

/* [2] CONFIGURAÇÕES DE CHAVES E SERVIÇOS */
// Em produção, use variáveis de ambiente!
const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

mercadopago.configure({ access_token: ACCESS_TOKEN });

/* [3] CONFIGURAÇÃO DO SERVIÇO DE E-MAIL */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb'
  }
});

/* [4] MAPEAMENTO DE PLANOS PARA ARQUIVOS */
const planos = {
  normal: 'instrucoesAssistenteFinanceiro.pdf',
  casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
  familia: 'instrucoesassistentefinanceiroplanofamilia.pdf'
};

/* [5] ROTA DE WEBHOOK - PROCESSAMENTO DE PAGAMENTOS */
app.post('/webhook', async (req, res) => {
  try {
    // Em produção, ative a verificação de assinatura!
    // if (!verifySignature(req, WEBHOOK_SECRET)) {
    //   return res.status(401).send('Assinatura inválida');
    // }

    const event = req.body;
    console.log('📩 Webhook recebido:', event.type);

    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;
      const paymentInfo = await mercadopago.payment.get(paymentId);
      console.log(`💰 Status do pagamento ${paymentId}:`, paymentInfo.body.status);

      if (paymentInfo.body.status === 'approved') {
        /* [5.1] VALIDAÇÃO DE E-MAIL */
        const email = paymentInfo.body.payer?.email;
        
        // Validação rigorosa do e-mail
        if (!email || !validarEmail(email)) {
          console.error('❌ E-mail inválido ou ausente:', { 
            paymentId, 
            providedEmail: email 
          });
          return res.status(400).json({
            status: 'erro',
            message: 'Endereço de e-mail do cliente inválido'
          });
        }

        /* [5.2] PROCESSAMENTO DO PLANO */
        const item = paymentInfo.body.additional_info.items[0];
        const plano = item.title.replace('Plano ', '').toLowerCase();
        const nomeArquivoPDF = planos[plano];

        if (!nomeArquivoPDF) {
          console.error('⚠️ Plano desconhecido:', { 
            plano, 
            paymentId, 
            email 
          });
          return res.status(400).json({
            status: 'erro',
            message: 'Plano contratado não existe'
          });
        }

        /* [5.3] ENVIO DE E-MAIL COM TENTATIVAS */
        const pdfPath = path.join(__dirname, nomeArquivoPDF);
        console.log('📄 Iniciando envio para:', { email, pdf: nomeArquivoPDF });

        try {
          await enviarEmailComRetry({
            to: email,
            subject: '✅ Seu material exclusivo chegou!',
            text: `Olá!\n\nAqui está seu guia do ${item.title}.\n\nAgradecemos sua compra!`,
            attachments: [{
              filename: nomeArquivoPDF,
              path: pdfPath,
              contentType: 'application/pdf'
            }]
          }, 3); // 3 tentativas

          console.log(`📧 E-mail enviado com sucesso para: ${email}`);
          return res.json({ status: 'sucesso', message: 'PDF enviado' });

        } catch (emailError) {
          console.error('❌ Falha no envio após retentativas:', {
            error: emailError.message,
            paymentId,
            email
          });
          throw new Error(`Falha final no envio para ${email}`);
        }

      } else {
        return res.json({ status: 'pendente', message: 'Pagamento não aprovado' });
      }
    }
    res.json({ status: 'ignorado', message: 'Evento não tratado' });
    
  } catch (error) {
    console.error('🔥 ERRO CRÍTICO:', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({
      status: 'erro',
      message: 'Falha no processamento',
      detalhes: error.message
    });
  }
});

/* [6] FUNÇÕES AUXILIARES */

// Validador robusto de e-mails
function validarEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(String(email).toLowerCase());
}

// Envio com retentativa automática
async function enviarEmailComRetry(mailOptions, maxTentativas = 3) {
  let tentativa = 0;
  
  while (tentativa < maxTentativas) {
    try {
      await transporter.sendMail({
        ...mailOptions,
        from: 'oficialfinanzap@gmail.com'
      });
      return;
    } catch (error) {
      tentativa++;
      console.warn(`Tentativa ${tentativa} falhou:`, error.message);
      
      if (tentativa >= maxTentativas) {
        throw error;
      }
      
      // Espera progressivamente mais tempo
      await new Promise(resolve => 
        setTimeout(resolve, 2000 * tentativa)
      );
    }
  }
}

/* [7] ROTA DE CRIAÇÃO DE PAGAMENTO PIX */
app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;

    // Validação básica dos dados
    if (!email || !plano) {
      return res.status(400).json({ 
        error: 'Dados incompletos' 
      });
    }

    const paymentData = {
      statement_descriptor: 'Finanzap',
      transaction_amount: 1.00,
      description: `Assinatura ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: uuidv4(),
      additional_info: {
        items: [{
          id: 'finanzap_001',
          title: `Plano ${plano}`,
          description: 'Acesso completo à plataforma',
          category_id: 'services',
          quantity: 1,
          unit_price: 1.00
        }]
      },
      payer: {
        email: email,
        first_name: 'Cliente',
        last_name: 'Finanzap',
        identification: {
          type: 'CPF',
          number: '12345678909'
        }
      }
    };

    const response = await mercadopago.payment.create(paymentData);
    const qrData = response.body.point_of_interaction?.transaction_data;

    res.json({
      paymentId: response.body.id,
      qrCode: qrData?.qr_code,
      qrCodeBase64: qrData?.qr_code_base64,
      status: response.body.status
    });

  } catch (error) {
    console.error('💥 Erro no pagamento:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Erro no processamento',
      detalhes: error.message
    });
  }
});

/* [8] VERIFICAÇÃO DE STATUS DE PAGAMENTO */
app.get('/status-pagamento/:paymentId', async (req, res) => {
  try {
    const paymentInfo = await mercadopago.payment.get(req.params.paymentId);
    res.json({
      status: paymentInfo.body.status,
      detalhes: paymentInfo.body.status_detail
    });
  } catch (error) {
    console.error('🔍 Erro na consulta:', {
      paymentId: req.params.paymentId,
      error: error.message
    });
    res.status(500).json({
      error: 'Erro na consulta',
      detalhes: error.message
    });
  }
});

/* [9] INICIALIZAÇÃO DO SERVIDOR */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

/* [10] MEDIDAS DE SEGURANÇA (IMPLEMENTAR EM PRODUÇÃO) 
- Usar variáveis de ambiente para credenciais
- Habilitar verificação de assinatura do webhook
- Configurar HTTPS
2- Implementar rate limiting
- Utilizar banco de dados para registro de transações
*/
