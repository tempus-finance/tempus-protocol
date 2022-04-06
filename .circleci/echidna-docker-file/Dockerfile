FROM cimg/node:17.7.2
RUN sudo apt-get update 
RUN sudo apt-get install python3-pip
RUN sudo pip3 install slither-analyzer
RUN sudo pip3 install solc-select
RUN sudo solc-select install 0.8.10
RUN sudo solc-select use 0.8.10
RUN sudo wget -O /tmp/echidna-test.tar.gz https://github.com/crytic/echidna/releases/download/v2.0.0/echidna-test-2.0.0-Ubuntu-18.04.tar.gz
RUN sudo tar -xf /tmp/echidna-test.tar.gz -C /usr/bin
RUN sudo chmod +x /usr/bin/echidna-test