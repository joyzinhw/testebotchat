const qrcode = require('qrcode-terminal');
const fs = require('fs');
const Papa = require('papaparse');
const { Client, LocalAuth } = require('whatsapp-web.js');
const notifier = require('node-notifier'); // Biblioteca para notificações e sons

// Configura o cliente do WhatsApp com autenticação local
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './session'
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Evita problemas de memória no Docker
            '--single-process', // Executa o Chromium em um único processo
            '--disable-software-rasterizer',
        ]
    }
});

async function startBot() {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    // Adicione o restante do seu código aqui, como interação com o navegador
}

startBot().catch(error => {
    console.error('Erro ao iniciar o bot:', error);
});

// Função para formatar a entrada do usuário
function formatarEntrada(texto) {
    if (!texto) return texto;

    // Verifica se o texto está todo em maiúsculo ou todo em minúsculo
    const todoMaiusculo = texto === texto.toUpperCase();
    const todoMinusculo = texto === texto.toLowerCase();

    if (todoMaiusculo || todoMinusculo) {
        // Transforma a primeira letra em maiúscula e o restante em minúscula
        return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
    } else {
        // Apenas transforma a primeira letra em maiúscula
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    }
}

// Função para carregar os dados do CSV
function carregarCSV(caminho) {
    try {
        const csv = fs.readFileSync(caminho, 'utf8');
        const data = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
        console.log(`Dados carregados de ${caminho}:`, data);
        return data;
    } catch (error) {
        console.error(`Erro ao carregar o arquivo CSV: ${caminho}`, error);
        return [];
    }
}

const precos = carregarCSV('precos.csv');
const plantao = carregarCSV('plantao.csv');

if (precos.length === 0 || plantao.length === 0) {
    console.error('Erro: Um ou mais arquivos CSV não foram carregados corretamente.');
    process.exit(1);
}

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});


client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    console.log('Tentando reconectar...');
    client.initialize();
});

client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
    console.log('Tentando reconectar...');
    client.initialize();
});

client.initialize();

const delay = ms => new Promise(res => setTimeout(res, ms));

const userState = {};

// Opções do menu
const menuOptions = {
    '1': agendarConsulta,
    '2': marcaRetorno, // Nova opção "Marca Retorno"
    '3': async (from) => {
        await client.sendMessage(from, 'Se precisar de algo mais, estou à disposição.');
        // Ativa o alarme
        notifier.notify({
            title: 'Alerta',
            message: 'Uma pessoa humana precisa responder!',
            sound: true, // Reproduz um som de notificação
            wait: true // Espera até que a notificação seja fechada
        });
    },
    '4': consultarPreco,
    '5': async (from) => {
        const msg = buscarMedicoPlantao();
        await client.sendMessage(from, msg);
    },
    '6': verProcedimentos,
    '7': diasEndoscopia,
    '8': pegarExame,
    '9': async (from) => {
        await client.sendMessage(from, 'Atendimento encerrado. Para retornar, basta enviar uma mensagem.');
        delete userState[from]; // Encerra o estado do usuário
    },
};

// Função para consultar preço de um procedimento
async function consultarPreco(from) {
    console.log('Enviando solicitação de preço para:', from);
    await client.sendMessage(from, 'Digite o nome do procedimento que deseja consultar o preço.');

    // Define o estado do usuário para aguardar o nome do procedimento
    userState[from] = { step: 'consultarPreco' };
}

// Função para buscar o preço de um procedimento
function buscarPreco(procedimento) {
    const procedimentoNormalizado = procedimento.toLowerCase().trim();
    console.log(`Procedimento buscado: ${procedimentoNormalizado}`);
    const resultados = precos.filter(p => {
        const procedimentoCSV = p.Procedimento.toLowerCase().trim();
        console.log(`Procedimento no CSV: ${procedimentoCSV}`);
        return procedimentoCSV.includes(procedimentoNormalizado);
    });

    if (resultados.length > 0) {
        let resposta = 'Aqui estão os procedimentos que encontrei:\n';
        resultados.forEach(item => {
            resposta += `- ${item.Procedimento}: R$ ${item.Valor}\n`;
        });
        return resposta;
    } else {
        return 'Desculpe, não encontrei nenhum procedimento com esse nome.';
    }
}

// Função para verificar se um procedimento é realizado na clínica
async function verProcedimentos(from) {
    console.log('Solicitando nome do procedimento para:', from);
    await client.sendMessage(from, 'Digite o nome do procedimento que deseja verificar se é realizado na clínica.');

    // Define o estado do usuário para aguardar o nome do procedimento
    userState[from] = { step: 'verProcedimento' };
}

// Função para verificar se o procedimento é realizado e retornar o preço
function verificarProcedimento(procedimento) {
    const procedimentoNormalizado = procedimento.toLowerCase().trim();
    console.log(`Procedimento buscado: ${procedimentoNormalizado}`);
    const resultados = precos.filter(p => {
        const procedimentoCSV = p.Procedimento.toLowerCase().trim();
        console.log(`Procedimento no CSV: ${procedimentoCSV}`);
        return procedimentoCSV.includes(procedimentoNormalizado);
    });

    if (resultados.length > 0) {
        let resposta = 'Aqui estão os procedimentos que encontrei:\n';
        resultados.forEach(item => {
            resposta += `- ${item.Procedimento}: R$ ${item.Valor}\n`;
        });
        return resposta;
    } else {
        return `Desculpe, o procedimento *${procedimento}* não é realizado na clínica.`;
    }
}

// Função para enviar o menu principal
async function enviarMenu(from, nome) {
    console.log('Enviando menu para:', from);
    try {
        await client.sendMessage(from, `Olá ${nome}! Sou o assistente virtual do Hospital. Como posso ajudá-lo hoje?  
Opções:  
1) Agendar Consulta  
2) Marcar Retorno
3) Outras Perguntas  
4) Consultar Preços  
5) Médico de Plantão  
6) Ver Procedimentos  
7) Dias de Endoscopia  
8) Pegar Exame  
9) Finalizar Atendimento`);
    } catch (error) {
        console.error('Erro ao enviar menu para:', from, error);
    }
}

// Função para buscar o médico de plantão
function buscarMedicoPlantao() {
    const agora = new Date();
    const diasSemana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const diaSemana = diasSemana[agora.getDay()]; // Obtém o dia da semana atual

    const horaAtual = agora.getHours();
    const minutoAtual = agora.getMinutes();
    const minutosAtual = horaAtual * 60 + minutoAtual; // Converte a hora atual para minutos

    const medico = plantao.find(p => {
        const [horaInicioStr, horaFimStr] = p.Horário.split('-').map(h => h.trim());
        
        // Converte o horário de início para minutos
        const horaInicio = parseInt(horaInicioStr.split('H')[0]);
        const minutosInicio = horaInicio * 60;

        // Converte o horário de fim para minutos
        const horaFim = parseInt(horaFimStr.split('H')[0]);
        const minutosFim = horaFim === 0 ? 24 * 60 : horaFim * 60; // Se for 0H, considera como 24H

        // Verifica se o dia da semana e o horário atual estão dentro do intervalo de plantão
        return p['Dia da Semana'].toLowerCase() === diaSemana &&
               minutosAtual >= minutosInicio && minutosAtual < minutosFim;
    });

    return medico ? `O médico de plantão agora é o ${medico.Médico}.` : 'Não há médicos de plantão no momento.';
}

// Função para agendar consulta
async function agendarConsulta(from) {
    console.log('Iniciando agendamento para:', from);
    userState[from] = { step: 'nome' };
    await client.sendMessage(from, 'Por favor, informe o nome completo do paciente.');
}

// Função para retono
    async function marcaRetorno(from) {
        console.log('Iniciando marcação de retorno para:', from);
        userState[from] = { step: 'retornoNome' };
        await client.sendMessage(from, 'Por favor, informe o nome completo do paciente para o retorno.');
    }
    

// Função para enviar informações sobre endoscopia
async function diasEndoscopia(from) {
    console.log('Enviando informações sobre endoscopia para:', from);
    const diasEndoscopia = ['07/03', '08/03', '14/03', '15/03', '28/03', '31/03'];
    const mensagem = `Aqui estão os dias disponíveis para endoscopia: ${diasEndoscopia.join(', ')}.`;
    await client.sendMessage(from, mensagem);
}

// Função para enviar informações sobre retirada de exame
async function pegarExame(from) {
    console.log('Enviando informações sobre retirada de exame para:', from);
    await client.sendMessage(from, 'Para pegar seu exame, é necessário apresentar o papel entregue após a realização do exame. A retirada pode ser feita a partir das 9 horas do dia indicado no papel.');
}

// Listener para mensagens recebidas

// Listener para mensagens recebidas
client.on('message', async msg => {
    const from = msg.from;

    // Verifica se a mensagem é de um usuário (não é do bot)
    if (from.endsWith('@c.us')) {
        console.log('Mensagem recebida de:', from, 'Conteúdo:', msg.body);

        let contato;
        try {
            contato = await msg.getContact();
        } catch (error) {
            console.error('Erro ao obter contato para:', from, error);
            return;
        }
        const nome = contato.pushname ? formatarEntrada(contato.pushname.split(" ")[0]) : 'Usuário';

        // Se o usuário já está em um estado de conversa (ex: agendamento), processa a resposta
        if (userState[from]) {
            const state = userState[from];
            try {
                switch (state.step) {
                    case 'nome':
                        state.nomePaciente = formatarEntrada(msg.body);
                        state.step = 'medico';
                        await client.sendMessage(from, 'Qual médico deseja consultar?');
                        break;
                    case 'medico':
                        state.medico = formatarEntrada(msg.body);
                        state.step = 'horario';
                        await client.sendMessage(from, 'Qual horário deseja marcar?');
                        break;
                    case 'horario':
                        state.horario = msg.body;
                        state.step = 'dia';
                        await client.sendMessage(from, 'Qual dia você deseja que a consulta seja realizada?');
                        break;
                    case 'dia':
                        state.dia = msg.body;
                        const confirmacao = `Consulta agendada:
Paciente: ${state.nomePaciente}
Médico: ${state.medico}
Horário: ${state.horario}
Dia: ${state.dia}
Se precisar de algo mais, estou à disposição.`;
                        await client.sendMessage(from, confirmacao);
                        delete userState[from];
                        await delay(2000);
                        await enviarMenu(from, state.nomePaciente.split(" ")[0]);
                        break;
                    case 'retornoNome':
                        // Para marcar retorno, repete o fluxo de agendamento de consulta
                        state.nomePaciente = formatarEntrada(msg.body);  // Nome do paciente
                        state.step = 'medicoRetorno';
                        await client.sendMessage(from, 'Qual médico deseja consultar para o retorno?');
                        break;
                    case 'medicoRetorno':
                        state.medico = formatarEntrada(msg.body);  // Médico do retorno
                        state.step = 'horarioRetorno';
                        await client.sendMessage(from, 'Qual horário deseja marcar para o retorno?');
                        break;
                    case 'horarioRetorno':
                        state.horario = msg.body;  // Horário do retorno
                        state.step = 'diaRetorno';
                        await client.sendMessage(from, 'Qual dia você deseja que o retorno seja realizado?');
                        break;
                    case 'diaRetorno':
                        state.dia = msg.body;  // Dia do retorno
                        const retornoConfirmacao = `Retorno agendado:
Paciente: ${state.nomePaciente}
Médico: ${state.medico}
Horário: ${state.horario}
Dia: ${state.dia}
Se precisar de algo mais, estou à disposição.`;
                        await client.sendMessage(from, retornoConfirmacao);
                        delete userState[from];
                        await delay(2000);
                        await enviarMenu(from, nome);
                        break;
                    case 'consultarPreco':
                        const procedimentoPreco = formatarEntrada(msg.body);
                        const respostaPreco = buscarPreco(procedimentoPreco);
                        await client.sendMessage(from, respostaPreco);
                        delete userState[from]; // Limpa o estado do usuário
                        await delay(2000);
                        await enviarMenu(from, nome);
                        break;
                    case 'verProcedimento':
                        const procedimento = formatarEntrada(msg.body);
                        const resposta = verificarProcedimento(procedimento);
                        await client.sendMessage(from, resposta);
                        delete userState[from]; // Limpa o estado do usuário
                        await delay(2000);
                        await enviarMenu(from, nome);
                        break;
                }
            } catch (error) {
                console.error('Erro ao processar mensagem para o usuário em estado:', from, error);
                await client.sendMessage(from, 'Desculpe, ocorreu um erro ao processar sua solicitação.');
            }
        } else {
            // Se a mensagem corresponde a uma opção de menu, processa
            if (menuOptions[msg.body]) {
                try {
                    await menuOptions[msg.body](from);
                } catch (error) {
                    console.error('Erro ao processar a opção do menu:', error);
                    await client.sendMessage(from, 'Desculpe, ocorreu um erro ao processar sua solicitação.');
                }
            } else {
                // Caso não corresponda a uma opção específica, envia o menu principal
                await enviarMenu(from, nome);
            }
        }
    }
});

// client.on('message', async msg => {
//     const from = msg.from;

//     // Verifica se a mensagem é de um usuário (não é do bot)
//     if (from.endsWith('@c.us')) {
//         console.log('Mensagem recebida de:', from, 'Conteúdo:', msg.body);

//         let contato;
//         try {
//             contato = await msg.getContact();
//         } catch (error) {
//             console.error('Erro ao obter contato para:', from, error);
//             return;
//         }
//         const nome = contato.pushname ? formatarEntrada(contato.pushname.split(" ")[0]) : 'Usuário';

//         // Se o usuário já está em um estado de conversa (ex: agendamento), processa a resposta
//         if (userState[from]) {
//             const state = userState[from];
//             try {
//                 switch (state.step) {
//                     case 'nome':
//                         state.nomePaciente = formatarEntrada(msg.body);
//                         state.step = 'medico';
//                         await client.sendMessage(from, 'Qual médico deseja consultar?');
//                         break;
//                     case 'medico':
//                         state.medico = formatarEntrada(msg.body);
//                         state.step = 'horario';
//                         await client.sendMessage(from, 'Qual horário deseja marcar?');
//                         break;
//                     case 'horario':
//                         state.horario = msg.body;
//                         state.step = 'dia';
//                         await client.sendMessage(from, 'Qual dia você deseja que a consulta seja realizada?');
//                         break;
//                     case 'dia':
//                         state.dia = msg.body;
//                         const confirmacao = `Consulta agendada:
// Paciente: ${state.nomePaciente}
// Médico: ${state.medico}
// Horário: ${state.horario}
// Dia: ${state.dia}
// Se precisar de algo mais, estou à disposição.`;
//                         await client.sendMessage(from, confirmacao);
//                         delete userState[from];
//                         await delay(2000);
//                         await enviarMenu(from, state.nomePaciente.split(" ")[0]);
//                         break;
//                     case 'consultarPreco':
//                         const procedimentoPreco = formatarEntrada(msg.body);
//                         const respostaPreco = buscarPreco(procedimentoPreco);
//                         await client.sendMessage(from, respostaPreco);
//                         delete userState[from]; // Limpa o estado do usuário
//                         await delay(2000);
//                         await enviarMenu(from, nome);
//                         break;
//                     case 'verProcedimento':
//                         const procedimento = formatarEntrada(msg.body);
//                         const resposta = verificarProcedimento(procedimento);
//                         await client.sendMessage(from, resposta);
//                         delete userState[from]; // Limpa o estado do usuário
//                         await delay(2000);
//                         await enviarMenu(from, nome);
//                         break;
//                 }
//             } catch (error) {
//                 console.error('Erro ao processar mensagem para o usuário em estado:', from, error);
//                 await client.sendMessage(from, 'Desculpe, ocorreu um erro ao processar sua solicitação.');
//             }
//         } else {
//             // Se a mensagem corresponde a uma opção de menu, processa
//             if (menuOptions[msg.body]) {
//                 try {
//                     await menuOptions[msg.body](from);
//                 } catch (error) {
//                     console.error('Erro ao processar a opção do menu:', error);
//                     await client.sendMessage(from, 'Desculpe, ocorreu um erro ao processar sua solicitação.');
//                 }
//             } else {
//                 // Caso não corresponda a uma opção específica, envia o menu principal
//                 await enviarMenu(from, nome);
//             }
//         }
//     }
// });
